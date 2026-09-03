"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  loadCastListExportBundle,
} from "@/features/casting/lib/cast-list-export-data";
import {
  buildCastListDocx,
  buildCastListPrintHtml,
} from "@/features/casting/lib/export-cast-list";
import type {
  CastListActorFieldId,
  CastListCandidateExportConfig,
  CastListCharacterFieldId,
  CastListSort,
} from "@/features/casting/lib/cast-list-export-fields";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

const tapeSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("audition"),
    auditionId: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("external"),
    url: z.string().url(),
    note: z.string().max(500),
  }),
]);

const candidateConfigSchema = z.object({
  candidateId: z.string().min(1),
  photoOverrideUrl: z.string().max(2000).nullable(),
  tapes: z.array(tapeSchema),
  commentIds: z.array(z.string()).nullable(),
  commentsManual: z.boolean(),
});

const exportPayloadSchema = z.object({
  characterId: z.string().min(1),
  format: z.enum(["docx", "pdf"]),
  sort: z.enum([
    "nameAsc",
    "nameDesc",
    "ratingDesc",
    "status",
    "createdAt",
  ]),
  characterFieldIds: z.array(z.string()),
  actorFieldIds: z.array(z.string()),
  candidateConfigs: z.array(candidateConfigSchema),
  locale: z.string().min(2).max(8).optional(),
});

export async function exportCastListAction(
  projectId: string,
  payload: unknown,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:read")) return { error: "Недостаточно прав" };

  const parsed = exportPayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: "Некорректные настройки экспорта" };

  const locale = parsed.data.locale ?? "ru";
  const bundle = await loadCastListExportBundle(
    projectId,
    parsed.data.characterId,
    locale,
  );
  if (!bundle) return { error: "Персонаж не найден" };
  if (bundle.candidates.length === 0) {
    return { error: "Нет кандидатов для экспорта" };
  }

  const args = {
    bundle,
    characterFieldIds: parsed.data
      .characterFieldIds as CastListCharacterFieldId[],
    actorFieldIds: parsed.data.actorFieldIds as CastListActorFieldId[],
    sort: parsed.data.sort as CastListSort,
    candidateConfigs: parsed.data
      .candidateConfigs as CastListCandidateExportConfig[],
  };

  if (parsed.data.format === "docx") {
    const buf = await buildCastListDocx(args);
    return {
      base64: buf.toString("base64"),
      fileName: `cast-list-${bundle.character.name}.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  return {
    html: buildCastListPrintHtml(args),
    fileName: `cast-list-${bundle.character.name}.html`,
  };
}

export async function toggleAuditionFavoriteAction(
  projectId: string,
  auditionId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const row = await prisma.audition.findFirst({
    where: { id: auditionId, projectId },
  });
  if (!row) return { error: "Проба не найдена" };

  const updated = await prisma.audition.update({
    where: { id: auditionId },
    data: { isFavorite: !row.isFavorite },
  });

  revalidatePath(`/ru/projects/${projectId}/preproduction/auditions`);
  revalidatePath(`/ru/projects/${projectId}/preproduction/casting`);
  revalidatePath(`/ru/projects/${projectId}/characters`);
  return {
    success: updated.isFavorite ? "В избранном" : "Убрано из избранного",
    isFavorite: updated.isFavorite,
  };
}

export async function addCastingCandidateCommentAction(
  projectId: string,
  candidateId: string,
  body: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const text = body.trim();
  if (!text || text.length > 4000) return { error: "Введите текст комментария" };

  const candidate = await prisma.castingCandidate.findFirst({
    where: { id: candidateId, projectId },
  });
  if (!candidate) return { error: "Кандидат не найден" };

  await prisma.castingCandidateComment.create({
    data: {
      candidateId,
      authorId: ctx.user.id,
      body: text,
    },
  });

  revalidatePath(`/ru/projects/${projectId}/characters/${candidate.characterId}`);
  revalidatePath(
    `/ru/projects/${projectId}/preproduction/casting/${candidate.personId}`,
  );
  return { success: "Комментарий добавлен" };
}

export async function deleteCastingCandidateCommentAction(
  projectId: string,
  commentId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const comment = await prisma.castingCandidateComment.findFirst({
    where: { id: commentId },
    include: { candidate: true },
  });
  if (!comment || comment.candidate.projectId !== projectId) {
    return { error: "Комментарий не найден" };
  }
  if (comment.authorId !== ctx.user.id && !ctx.can("project:write")) {
    return { error: "Можно удалить только свой комментарий" };
  }

  await prisma.castingCandidateComment.delete({ where: { id: commentId } });
  revalidatePath(
    `/ru/projects/${projectId}/characters/${comment.candidate.characterId}`,
  );
  revalidatePath(
    `/ru/projects/${projectId}/preproduction/casting/${comment.candidate.personId}`,
  );
  return { success: "Комментарий удалён" };
}
