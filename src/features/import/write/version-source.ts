import "server-only";

import { createHash } from "crypto";
import type { ScriptBlockType } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";

type VersionBlock = { id: string; type: ScriptBlockType; content: string; sceneId: string | null };

/**
 * Хэш блоков версии для синхронизации: id, тип, текст и сцена. Сверяется при записи —
 * блоки изменились (правка версии, вторая вкладка, повторное нажатие) — отказ.
 */
export function versionBlocksHash(blocks: readonly VersionBlock[]) {
  return createHash("sha256")
    .update(JSON.stringify(blocks.map((b) => [b.id, b.type, b.content, b.sceneId])))
    .digest("hex");
}

/** Версия этого проекта и её блоки по порядку — источник синхронизации с либретто. Только чтение. */
export async function loadVersionSource(projectId: string, versionId: string) {
  const version = await prisma.scriptVersion.findFirst({
    where: { id: versionId, projectId },
    select: {
      id: true,
      versionNumber: true,
      title: true,
      blocks: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, type: true, content: true, sceneId: true },
      },
    },
  });
  if (!version) return null;
  return { ...version, hash: versionBlocksHash(version.blocks) };
}
