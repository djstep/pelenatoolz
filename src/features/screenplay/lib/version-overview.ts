import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { estimateScreenplayTiming } from "@/features/screenplay/lib/timing";
import type { ScriptVersionOverviewRow } from "@/features/screenplay/lib/version-types";
import { listScriptVersions } from "@/features/screenplay/lib/versions";
import { prisma } from "@/shared/db/prisma";
import type { TimingMode } from "@prisma/client";

export async function listScriptVersionsOverview(
  projectId: string,
  timingMode: TimingMode,
  pageToMinuteRatio: number,
  sceneTimings: { sceneId: string; planSeconds: number | null }[],
): Promise<ScriptVersionOverviewRow[]> {
  const versions = await listScriptVersions(projectId);
  if (versions.length === 0) return [];

  const versionIds = versions.map((version) => version.id);
  const rows = await prisma.scriptBlock.findMany({
    where: { scriptVersionId: { in: versionIds } },
    orderBy: [{ scriptVersionId: "asc" }, { sortOrder: "asc" }],
    select: {
      id: true,
      scriptVersionId: true,
      type: true,
      content: true,
      contentHtml: true,
      sceneId: true,
      sortOrder: true,
    },
  });

  const blocksByVersion = new Map<string, ScreenplayBlock[]>();
  for (const row of rows) {
    const list = blocksByVersion.get(row.scriptVersionId) ?? [];
    list.push({
      id: row.id,
      type: row.type,
      content: row.content,
      contentHtml: row.contentHtml,
      sceneId: row.sceneId,
      sortOrder: row.sortOrder,
    });
    blocksByVersion.set(row.scriptVersionId, list);
  }

  return versions.map((version) => {
    const blocks = blocksByVersion.get(version.id) ?? [];
    const timing = estimateScreenplayTiming(
      blocks,
      timingMode,
      pageToMinuteRatio,
      sceneTimings,
    );

    return {
      ...version,
      timingLabel: timing.label,
      timingPages: timing.pages > 0 ? timing.pages : undefined,
    };
  });
}
