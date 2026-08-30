"use server";

import { ScriptBlockType, TimingMode } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import {
  buildScreenplayDocx,
  buildScreenplayPrintHtml,
} from "@/features/screenplay/lib/export-screenplay";
import { buildLibrettoPreviewFromBlocks } from "@/features/screenplay/lib/libretto-sync";
import { applyScenesFromPreview } from "@/features/screenplay/lib/libretto-apply";
import { mergeSceneEdits } from "@/features/import/merge-scene-edits";
import type { ImportPreviewScene } from "@/features/import/types";
import {
  linkBlocksToExistingScenes,
  syncSluglineFromScene,
} from "@/features/screenplay/lib/sync";
import {
  createScriptVersion,
  deleteScriptVersion,
  getScriptVersion,
  listVersionBlocks,
  replaceVersionBlocks,
  setCurrentScriptVersion,
} from "@/features/screenplay/lib/versions";
import { bootstrapScriptBlocks } from "@/features/screenplay/lib/sync";
import { listScenes } from "@/features/script/queries";
import { prisma } from "@/shared/db/prisma";
import { writeAuditLog } from "@/shared/audit/log";

export type ScreenplayActionState = {
  error?: string;
  success?: string;
  versionId?: string;
};

const blockSchema = z.object({
  id: z.string().min(1),
  type: z.enum(ScriptBlockType),
  content: z.string().max(200_000),
  contentHtml: z.string().max(500_000).nullable().optional(),
  sceneId: z.string().nullable(),
  sortOrder: z.number().int().min(0),
});

const saveSchema = z.object({
  blocks: z.array(blockSchema),
});

function revalidateScreenplay(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/screenplay`);
  revalidatePath(`/ru/projects/${projectId}/libretto`);
  revalidatePath(`/ru/projects/${projectId}/script`);
}

function parseBlocksJson(blocksJson: string) {
  const parsed = saveSchema.parse(JSON.parse(blocksJson));
  return parsed.blocks as ScreenplayBlock[];
}

export async function loadScreenplayBlocksAction(
  projectId: string,
  versionId?: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:read")) {
    return { error: "Недостаточно прав" as const };
  }

  const { ensureCurrentScriptVersion } = await import(
    "@/features/screenplay/lib/versions"
  );
  const { bootstrapScriptBlocks } = await import("@/features/screenplay/lib/sync");

  const version =
    versionId != null
      ? await getScriptVersion(projectId, versionId)
      : await ensureCurrentScriptVersion(projectId, ctx.user.id!);

  if (!version) return { error: "Версия не найдена" as const };

  await bootstrapScriptBlocks(projectId, ctx.user.id!, version.id);
  const blocks = await listVersionBlocks(version.id);
  return { blocks, versionId: version.id };
}

export async function saveScreenplayVersionAction(
  projectId: string,
  versionId: string,
  mode: "same" | "new",
  blocksJson: string,
  title?: string,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  let blocks: ScreenplayBlock[];
  try {
    blocks = parseBlocksJson(blocksJson);
  } catch {
    return { error: "Некорректные данные сценария" };
  }

  blocks = await linkBlocksToExistingScenes(projectId, blocks);

  const source = await getScriptVersion(projectId, versionId);
  if (!source) return { error: "Версия не найдена" };

  if (mode === "same" && source.isLocked) {
    return { error: "Версия заблокирована для редактирования" };
  }

  if (mode === "new") {
    const trimmedTitle = title?.trim();
    if (!trimmedTitle) {
      return { error: "Укажите название новой версии" };
    }

    const version = await createScriptVersion({
      projectId,
      createdById: ctx.user.id!,
      sourceType: "DUPLICATED_FROM",
      sourceVersionId: versionId,
      title: trimmedTitle,
      makeCurrent: true,
      blocks,
    });
    revalidateScreenplay(projectId);
    return {
      success: "Создана новая версия сценария",
      versionId: version.id,
    };
  }

  await replaceVersionBlocks(projectId, versionId, blocks);
  revalidateScreenplay(projectId);
  return { success: "Версия сохранена", versionId };
}

export async function duplicateScriptVersionAction(
  projectId: string,
  versionId: string,
  title?: string,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const source = await getScriptVersion(projectId, versionId);
  if (!source) return { error: "Версия не найдена" };

  const sourceLabel = source.title?.trim() || `Версия ${source.versionNumber}`;
  const duplicateTitle =
    title?.trim() || `Копия: ${sourceLabel}`.slice(0, 200);

  const version = await createScriptVersion({
    projectId,
    createdById: ctx.user.id!,
    sourceType: "DUPLICATED_FROM",
    sourceVersionId: versionId,
    title: duplicateTitle,
    note: source.note,
    makeCurrent: false,
  });

  revalidateScreenplay(projectId);
  return {
    success: "Версия продублирована",
    versionId: version.id,
  };
}

export async function previewLibrettoSyncAction(
  projectId: string,
  versionId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" as const };
  }

  const version = await getScriptVersion(projectId, versionId);
  if (!version) return { error: "Версия не найдена" as const };

  const blocks = await listVersionBlocks(versionId);
  const existing = await listScenes(projectId);
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { timingMode: true, pageToMinuteRatio: true },
  });
  const scenes = buildLibrettoPreviewFromBlocks(
    blocks,
    existing,
    project.timingMode,
    Number(project.pageToMinuteRatio),
  );

  return { scenes, versionId };
}

export async function applyLibrettoSyncAction(
  projectId: string,
  versionId: string,
  scenesJson: string,
  formData: FormData,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const version = await getScriptVersion(projectId, versionId);
  if (!version) return { error: "Версия не найдена" };

  let scenes: ImportPreviewScene[];
  try {
    const base = JSON.parse(scenesJson) as ImportPreviewScene[];
    scenes = base.map((scene) => mergeSceneEdits(scene, formData));
  } catch {
    return { error: "Некорректные данные предпросмотра" };
  }

  const result = await applyScenesFromPreview(projectId, scenes, formData);

  const blocks = await listVersionBlocks(versionId);
  const linked = await linkBlocksToExistingScenes(projectId, blocks);
  await replaceVersionBlocks(projectId, versionId, linked);
  await setCurrentScriptVersion(projectId, versionId);

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "script_version",
    entityId: versionId,
    action: "UPDATE",
    summary: `Либретто: создано ${result.created}, обновлено ${result.updated}`,
  });

  revalidateScreenplay(projectId);
  return {
    success: `Либретто обновлено: создано сцен ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped}`,
  };
}

export async function syncSceneSluglineAction(
  projectId: string,
  sceneId: string,
): Promise<void> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return;
  await syncSluglineFromScene(sceneId);
  revalidateScreenplay(projectId);
}

async function loadExportBlocks(projectId: string, versionId: string) {
  return prisma.scriptBlock.findMany({
    where: { projectId, scriptVersionId: versionId },
    orderBy: { sortOrder: "asc" },
    select: { type: true, content: true },
  });
}

export async function exportScreenplayFountainAction(
  projectId: string,
  versionId: string,
): Promise<{ content: string; fileName: string } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:read")) {
    return { error: "Недостаточно прав" };
  }

  const version = await getScriptVersion(projectId, versionId);
  if (!version) return { error: "Версия не найдена" };

  const blocks = await loadExportBlocks(projectId, versionId);
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === "BONEYARD" || block.type === "NOTE" || block.type === "FOLDER") {
      continue;
    }
    const text = block.content.trim();
    if (!text) continue;
    if (block.type === "SLUGLINE") lines.push(text.toUpperCase(), "");
    else if (block.type === "CHARACTER") lines.push(text.toUpperCase());
    else if (block.type === "PARENTHETICAL") lines.push(`(${text.replace(/^\(|\)$/g, "")})`);
    else if (block.type === "TRANSITION") lines.push(`${text.toUpperCase()}\n`);
    else lines.push(text);
  }

  return {
    content: `${lines.join("\n")}\n`,
    fileName: `screenplay-v${version.versionNumber}.fountain`,
  };
}

export async function exportScreenplayDocxAction(
  projectId: string,
  versionId: string,
): Promise<{ base64: string; fileName: string } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:read")) {
    return { error: "Недостаточно прав" };
  }

  const version = await getScriptVersion(projectId, versionId);
  if (!version) return { error: "Версия не найдена" };

  const blocks = await loadExportBlocks(projectId, versionId);
  const buffer = await buildScreenplayDocx(blocks);
  return {
    base64: buffer.toString("base64"),
    fileName: `screenplay-v${version.versionNumber}.docx`,
  };
}

export async function exportScreenplayPrintHtmlAction(
  projectId: string,
  versionId: string,
): Promise<{ html: string; fileName: string } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:read")) {
    return { error: "Недостаточно прав" };
  }

  const [blocks, project, version] = await Promise.all([
    loadExportBlocks(projectId, versionId),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    }),
    getScriptVersion(projectId, versionId),
  ]);

  if (!version) return { error: "Версия не найдена" };

  const title = project?.name ?? "Сценарий";
  return {
    html: buildScreenplayPrintHtml(blocks, title),
    fileName: `screenplay-v${version.versionNumber}.html`,
  };
}

export async function setScriptVersionCurrentAction(
  projectId: string,
  versionId: string,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const version = await getScriptVersion(projectId, versionId);
  if (!version) return { error: "Версия не найдена" };

  await setCurrentScriptVersion(projectId, versionId);
  revalidateScreenplay(projectId);
  return { success: "Версия отмечена как текущая (без обновления либретто)" };
}

export async function renameScriptVersionAction(
  projectId: string,
  versionId: string,
  title: string,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const version = await getScriptVersion(projectId, versionId);
  if (!version) return { error: "Версия не найдена" };

  const trimmed = title.trim();
  if (version.isLocked && trimmed !== (version.title ?? "").trim()) {
    return { error: "Версия заблокирована для редактирования" };
  }

  await prisma.scriptVersion.update({
    where: { id: versionId, projectId },
    data: { title: trimmed.length > 0 ? trimmed.slice(0, 200) : null },
  });

  revalidateScreenplay(projectId);
  return { success: "Название версии обновлено" };
}

export async function updateScriptVersionNoteAction(
  projectId: string,
  versionId: string,
  note: string,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const version = await getScriptVersion(projectId, versionId);
  if (!version) return { error: "Версия не найдена" };

  if (version.isLocked) {
    return { error: "Версия заблокирована для редактирования" };
  }

  const trimmed = note.trim();
  await prisma.scriptVersion.update({
    where: { id: versionId, projectId },
    data: { note: trimmed.length > 0 ? trimmed.slice(0, 2000) : null },
  });

  revalidateScreenplay(projectId);
  return { success: "Комментарий к версии сохранён" };
}

export async function setScriptVersionLockedAction(
  projectId: string,
  versionId: string,
  locked: boolean,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const version = await getScriptVersion(projectId, versionId);
  if (!version) return { error: "Версия не найдена" };

  await prisma.scriptVersion.update({
    where: { id: versionId, projectId },
    data: { isLocked: locked },
  });

  revalidateScreenplay(projectId);
  return {
    success: locked ? "Версия заблокирована" : "Версия разблокирована",
  };
}

export async function deleteScriptVersionAction(
  projectId: string,
  versionId: string,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const version = await getScriptVersion(projectId, versionId);
  if (!version) return { error: "Версия не найдена" };

  if (version.isLocked) {
    return { error: "Сначала разблокируйте версию" };
  }

  const result = await deleteScriptVersion(projectId, versionId);
  if ("error" in result) {
    return { error: result.error };
  }

  revalidateScreenplay(projectId);
  return { success: "Версия удалена" };
}

export async function listScriptCommentsAction(
  projectId: string,
  versionId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:read")) {
    return { error: "Недостаточно прав" as const };
  }

  const version = await getScriptVersion(projectId, versionId);
  if (!version) return { error: "Версия не найдена" as const };

  const rows = await prisma.scriptComment.findMany({
    where: { scriptVersionId: versionId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true } } },
  });

  return {
    comments: rows.map((row) => ({
      id: row.id,
      scriptVersionId: row.scriptVersionId,
      startBlockId: row.startBlockId,
      endBlockId: row.endBlockId,
      rangeStart: row.rangeStart,
      rangeEnd: row.rangeEnd,
      content: row.content,
      status: row.status,
      parentCommentId: row.parentCommentId,
      createdAt: row.createdAt.toISOString(),
      author: row.author,
    })),
  };
}

export async function createScriptCommentAction(
  projectId: string,
  versionId: string,
  payload: {
    startBlockId: string;
    endBlockId: string;
    rangeStart: number;
    rangeEnd: number;
    content: string;
  },
): Promise<ScreenplayActionState & { commentId?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const trimmed = payload.content.trim();
  if (!trimmed) return { error: "Введите текст комментария" };

  const version = await getScriptVersion(projectId, versionId);
  if (!version) return { error: "Версия не найдена" };

  const comment = await prisma.scriptComment.create({
    data: {
      scriptVersionId: versionId,
      startBlockId: payload.startBlockId,
      endBlockId: payload.endBlockId,
      rangeStart: payload.rangeStart,
      rangeEnd: payload.rangeEnd,
      content: trimmed.slice(0, 5000),
      authorId: ctx.user.id!,
    },
  });

  return { success: "Комментарий добавлен", commentId: comment.id };
}

export async function replyScriptCommentAction(
  projectId: string,
  versionId: string,
  parentCommentId: string,
  content: string,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const trimmed = content.trim();
  if (!trimmed) return { error: "Введите текст ответа" };

  const parent = await prisma.scriptComment.findFirst({
    where: { id: parentCommentId, scriptVersionId: versionId },
  });
  if (!parent) return { error: "Комментарий не найден" };

  await prisma.scriptComment.create({
    data: {
      scriptVersionId: versionId,
      startBlockId: parent.startBlockId,
      endBlockId: parent.endBlockId,
      rangeStart: parent.rangeStart,
      rangeEnd: parent.rangeEnd,
      content: trimmed.slice(0, 5000),
      authorId: ctx.user.id!,
      parentCommentId: parent.id,
    },
  });

  return { success: "Ответ добавлен" };
}

export async function resolveScriptCommentAction(
  projectId: string,
  commentId: string,
  resolved: boolean,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const comment = await prisma.scriptComment.findUnique({
    where: { id: commentId },
    include: { scriptVersion: { select: { projectId: true } } },
  });
  if (!comment || comment.scriptVersion.projectId !== projectId) {
    return { error: "Комментарий не найден" };
  }

  await prisma.scriptComment.update({
    where: { id: commentId },
    data: { status: resolved ? "RESOLVED" : "OPEN" },
  });

  return { success: resolved ? "Комментарий решён" : "Комментарий открыт" };
}

export async function deleteScriptCommentAction(
  projectId: string,
  commentId: string,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const comment = await prisma.scriptComment.findUnique({
    where: { id: commentId },
    include: { scriptVersion: { select: { projectId: true } } },
  });
  if (!comment || comment.scriptVersion.projectId !== projectId) {
    return { error: "Комментарий не найден" };
  }

  await prisma.scriptComment.delete({ where: { id: commentId } });
  return { success: "Комментарий удалён" };
}

const updateTimingSchema = z.object({
  timingMode: z.nativeEnum(TimingMode),
  pageToMinuteRatio: z.coerce.number().min(0.1).max(10).optional(),
});

export async function updateProjectTimingAction(
  projectId: string,
  timingMode: TimingMode,
  pageToMinuteRatio?: number,
): Promise<ScreenplayActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const parsed = updateTimingSchema.safeParse({
    timingMode,
    pageToMinuteRatio,
  });
  if (!parsed.success) {
    return { error: "Некорректные параметры хронометража" };
  }

  await prisma.project.update({
    where: { id: projectId },
    data: {
      timingMode: parsed.data.timingMode,
      ...(parsed.data.pageToMinuteRatio != null
        ? { pageToMinuteRatio: parsed.data.pageToMinuteRatio }
        : {}),
    },
  });

  revalidateScreenplay(projectId);
  revalidatePath(`/ru/projects/${projectId}/settings`);
  revalidatePath(`/ru/projects/${projectId}/libretto`);

  return { success: "Метод хронометража обновлён" };
}
