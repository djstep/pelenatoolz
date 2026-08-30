import type { ScriptVersionSourceType } from "@prisma/client";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import type { ScriptVersionRow } from "@/features/screenplay/lib/version-types";
import { prisma } from "@/shared/db/prisma";

export type { ScriptVersionRow } from "@/features/screenplay/lib/version-types";
export { versionLabel } from "@/features/screenplay/lib/version-label";

export async function getNextVersionNumber(projectId: string) {
  const agg = await prisma.scriptVersion.aggregate({
    where: { projectId },
    _max: { versionNumber: true },
  });
  return (agg._max.versionNumber ?? 0) + 1;
}

export async function getCurrentScriptVersion(projectId: string) {
  return prisma.scriptVersion.findFirst({
    where: { projectId, isCurrent: true },
    orderBy: { versionNumber: "desc" },
  });
}

export async function ensureCurrentScriptVersion(
  projectId: string,
  createdById: string,
) {
  const existing = await getCurrentScriptVersion(projectId);
  if (existing) return existing;

  const versionNumber = await getNextVersionNumber(projectId);
  return prisma.scriptVersion.create({
    data: {
      projectId,
      versionNumber,
      title: null,
      isCurrent: true,
      sourceType: "MANUAL",
      createdById,
    },
  });
}

export async function setCurrentScriptVersion(
  projectId: string,
  versionId: string,
) {
  await prisma.$transaction([
    prisma.scriptVersion.updateMany({
      where: { projectId, isCurrent: true },
      data: { isCurrent: false },
    }),
    prisma.scriptVersion.update({
      where: { id: versionId, projectId },
      data: { isCurrent: true },
    }),
  ]);
}

export async function listScriptVersions(
  projectId: string,
): Promise<ScriptVersionRow[]> {
  const rows = await prisma.scriptVersion.findMany({
    where: { projectId },
    orderBy: { versionNumber: "asc" },
    include: {
      createdBy: { select: { id: true, name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    versionNumber: row.versionNumber,
    title: row.title,
    note: row.note,
    isCurrent: row.isCurrent,
    isLocked: row.isLocked,
    sourceType: row.sourceType,
    sourceVersionId: row.sourceVersionId,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  }));
}

export async function getScriptVersion(projectId: string, versionId: string) {
  return prisma.scriptVersion.findFirst({
    where: { id: versionId, projectId },
    include: {
      createdBy: { select: { id: true, name: true } },
      _count: { select: { blocks: true } },
    },
  });
}

export async function listVersionBlocks(versionId: string) {
  return prisma.scriptBlock.findMany({
    where: { scriptVersionId: versionId },
    orderBy: { sortOrder: "asc" },
  });
}

export async function replaceVersionBlocks(
  projectId: string,
  versionId: string,
  blocks: ScreenplayBlock[],
) {
  const existingIds = new Set(
    (
      await prisma.scriptBlock.findMany({
        where: { scriptVersionId: versionId },
        select: { id: true },
      })
    ).map((row) => row.id),
  );

  const incomingIds = new Set(blocks.map((block) => block.id));

  await prisma.$transaction(async (tx) => {
    const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
    if (toDelete.length > 0) {
      await tx.scriptBlock.deleteMany({
        where: { id: { in: toDelete }, scriptVersionId: versionId },
      });
    }

    for (const block of blocks) {
      const data = {
        projectId,
        scriptVersionId: versionId,
        sceneId: block.sceneId,
        type: block.type,
        content: block.content,
        contentHtml: block.contentHtml ?? null,
        sortOrder: block.sortOrder,
      };

      if (existingIds.has(block.id) && !block.id.startsWith("new-")) {
        await tx.scriptBlock.update({
          where: { id: block.id },
          data,
        });
      } else {
        const { nanoid } = await import("nanoid");
        const id = block.id.startsWith("new-") ? nanoid() : block.id;
        await tx.scriptBlock.create({ data: { id, ...data } });
      }
    }
  });
}

export async function copyBlocksBetweenVersions(
  projectId: string,
  sourceVersionId: string,
  targetVersionId: string,
) {
  const source = await prisma.scriptBlock.findMany({
    where: { scriptVersionId: sourceVersionId },
    orderBy: { sortOrder: "asc" },
  });

  if (source.length === 0) return;

  const { nanoid } = await import("nanoid");
  await prisma.scriptBlock.createMany({
    data: source.map((block) => ({
      id: nanoid(),
      projectId,
      scriptVersionId: targetVersionId,
      sceneId: block.sceneId,
      type: block.type,
      content: block.content,
      contentHtml: block.contentHtml ?? null,
      sortOrder: block.sortOrder,
    })),
  });
}

export async function createScriptVersion({
  projectId,
  createdById,
  sourceType,
  sourceVersionId,
  title,
  note,
  makeCurrent,
  blocks,
}: {
  projectId: string;
  createdById: string;
  sourceType: ScriptVersionSourceType;
  sourceVersionId?: string | null;
  title?: string | null;
  note?: string | null;
  makeCurrent: boolean;
  blocks?: ScreenplayBlock[];
}) {
  const versionNumber = await getNextVersionNumber(projectId);

  return prisma.$transaction(async (tx) => {
    if (makeCurrent) {
      await tx.scriptVersion.updateMany({
        where: { projectId, isCurrent: true },
        data: { isCurrent: false },
      });
    }

    const version = await tx.scriptVersion.create({
      data: {
        projectId,
        versionNumber,
        title: title?.trim() ? title.trim().slice(0, 200) : null,
        note: note?.trim() ? note.trim().slice(0, 2000) : null,
        isCurrent: makeCurrent,
        sourceType,
        sourceVersionId: sourceVersionId ?? null,
        createdById,
      },
    });

    if (blocks && blocks.length > 0) {
      const { nanoid } = await import("nanoid");
      await tx.scriptBlock.createMany({
        data: blocks.map((block, index) => ({
          id: block.id.startsWith("new-") ? nanoid() : block.id,
          projectId,
          scriptVersionId: version.id,
          sceneId: block.sceneId,
          type: block.type,
          content: block.content,
          contentHtml: block.contentHtml ?? null,
          sortOrder: block.sortOrder ?? index,
        })),
      });
    } else if (sourceVersionId) {
      const source = await tx.scriptBlock.findMany({
        where: { scriptVersionId: sourceVersionId },
        orderBy: { sortOrder: "asc" },
      });
      if (source.length > 0) {
        const { nanoid } = await import("nanoid");
        await tx.scriptBlock.createMany({
          data: source.map((block) => ({
            id: nanoid(),
            projectId,
            scriptVersionId: version.id,
            sceneId: block.sceneId,
            type: block.type,
            content: block.content,
            contentHtml: block.contentHtml ?? null,
            sortOrder: block.sortOrder,
          })),
        });
      }
    }

    return version;
  });
}

export async function deleteScriptVersion(projectId: string, versionId: string) {
  const version = await prisma.scriptVersion.findFirst({
    where: { id: versionId, projectId },
  });
  if (!version) {
    return { error: "Версия не найдена" as const };
  }

  const total = await prisma.scriptVersion.count({ where: { projectId } });
  if (total <= 1) {
    return { error: "Нельзя удалить единственную версию сценария" as const };
  }

  const wasCurrent = version.isCurrent;

  await prisma.scriptVersion.delete({ where: { id: versionId } });

  if (wasCurrent) {
    const fallback = await prisma.scriptVersion.findFirst({
      where: { projectId },
      orderBy: { versionNumber: "desc" },
    });
    if (fallback) {
      await prisma.scriptVersion.update({
        where: { id: fallback.id },
        data: { isCurrent: true },
      });
    }
  }

  return { success: true as const };
}
