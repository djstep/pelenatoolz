"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { parseDateInput } from "@/features/schedule/lib/date-range";
import { prisma } from "@/shared/db/prisma";

const optionalText = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    const t = (v ?? "").trim();
    return t.length ? t : null;
  });

const optionalId = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => {
    const t = (v ?? "").trim();
    return t.length ? t : null;
  });

const actorSchema = z.object({
  personId: z.string().min(1),
  characterId: optionalId,
});

const createSchema = z.object({
  videoFileId: optionalId,
  externalUrl: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      const t = (v ?? "").trim();
      return t.length ? t : null;
    })
    .refine((v) => v == null || /^https?:\/\//i.test(v), {
      message: "Ссылка должна начинаться с http:// или https://",
    }),
  date: z.string().min(1),
  time: optionalText,
  sceneId: optionalId,
  isSelfTape: z.boolean().optional().default(false),
  comment: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      const t = (v ?? "").trim();
      return t.length ? t.slice(0, 5000) : null;
    }),
  actors: z.array(actorSchema).min(1),
});

export type CreateAuditionPayload = z.infer<typeof createSchema>;

function revalidateAuditions(projectId: string, personIds: string[] = []) {
  revalidatePath(`/ru/projects/${projectId}/preproduction/auditions`);
  revalidatePath(`/ru/projects/${projectId}/preproduction/casting`);
  for (const personId of personIds) {
    revalidatePath(
      `/ru/projects/${projectId}/preproduction/casting/${personId}`,
    );
  }
}

async function ensureCastingCandidates(
  projectId: string,
  actors: { personId: string; characterId?: string | null }[],
) {
  for (const a of actors) {
    if (!a.characterId) continue;
    await prisma.castingCandidate.upsert({
      where: {
        characterId_personId: {
          characterId: a.characterId,
          personId: a.personId,
        },
      },
      create: {
        projectId,
        characterId: a.characterId,
        personId: a.personId,
      },
      update: {},
    });
  }
}

export async function createAuditionAction(
  projectId: string,
  payload: unknown,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: first?.message
        ? `Проверьте данные пробы: ${first.message}`
        : "Проверьте данные пробы",
    };
  }

  const data = parsed.data;
  if (!data.videoFileId && !data.externalUrl) {
    return { error: "Загрузите видео или укажите внешнюю ссылку" };
  }

  const date = parseDateInput(data.date);
  if (!date) return { error: "Некорректная дата" };

  if (data.videoFileId) {
    const file = await prisma.projectFile.findFirst({
      where: { id: data.videoFileId, projectId, kind: "VIDEO" },
    });
    if (!file) return { error: "Видеофайл не найден" };
  }

  const personIds = [...new Set(data.actors.map((a) => a.personId))];
  const people = await prisma.castingPerson.findMany({
    where: { id: { in: personIds }, projectId },
    select: { id: true },
  });
  if (people.length !== personIds.length) {
    return { error: "Один из кандидатов не найден" };
  }

  await ensureCastingCandidates(projectId, data.actors);

  try {
    const audition = await prisma.audition.create({
      data: {
        projectId,
        videoFileId: data.videoFileId ?? null,
        externalUrl: data.externalUrl,
        date,
        time: data.time,
        sceneId: data.sceneId,
        isSelfTape: data.isSelfTape,
        comment: data.comment,
        createdById: ctx.user.id,
        actors: {
          create: data.actors.map((a) => ({
            personId: a.personId,
            characterId: a.characterId ?? null,
          })),
        },
      },
    });

    revalidateAuditions(projectId, personIds);
    return { success: "Проба добавлена", id: audition.id };
  } catch (err) {
    console.error("[createAudition]", err);
    return { error: "Не удалось сохранить пробу" };
  }
}

export async function createAuditionsBatchAction(
  projectId: string,
  items: unknown[],
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  if (!Array.isArray(items) || items.length === 0) {
    return { error: "Нет проб для сохранения" };
  }

  const ids: string[] = [];
  const allPersonIds = new Set<string>();

  for (const item of items) {
    const result = await createAuditionAction(projectId, item);
    if ("error" in result && result.error) {
      return {
        error: result.error,
        createdIds: ids,
      };
    }
    if ("id" in result && result.id) ids.push(result.id);
  }

  return {
    success: `Добавлено проб: ${ids.length}`,
    createdIds: ids,
  };
}

export async function deleteAuditionAction(
  projectId: string,
  auditionId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.audition.findFirst({
    where: { id: auditionId, projectId },
    include: { actors: { select: { personId: true } } },
  });
  if (!existing) return { error: "Проба не найдена" };

  await prisma.audition.delete({ where: { id: auditionId } });
  revalidateAuditions(
    projectId,
    existing.actors.map((a) => a.personId),
  );
  return { success: "Проба удалена" };
}
