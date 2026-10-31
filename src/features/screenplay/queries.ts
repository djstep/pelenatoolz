import { prisma } from "@/shared/db/prisma";
import {
  ensureCurrentScriptVersion,
  getCurrentScriptVersion,
  getScriptVersion,
  listScriptVersions,
  listVersionBlocks,
} from "@/features/screenplay/lib/versions";

export type { ScriptVersionRow } from "@/features/screenplay/lib/version-types";
export { versionLabel } from "@/features/screenplay/lib/version-label";
export {
  ensureCurrentScriptVersion,
  getCurrentScriptVersion,
  getScriptVersion,
  listScriptVersions,
  listVersionBlocks,
};

export async function listScriptCommentsForVersion(versionId: string) {
  const rows = await prisma.scriptComment.findMany({
    where: { scriptVersionId: versionId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true } } },
  });

  return rows.map((row) => ({
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
  }));
}

export async function getProjectScreenplayMeta(projectId: string) {
  return prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      type: true,
      timingMode: true,
      pageToMinuteRatio: true,
    },
  });
}
