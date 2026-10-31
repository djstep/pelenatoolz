import type { ScriptBlockType } from "@prisma/client";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { scriptContentToBlocks } from "@/features/screenplay/lib/block-serialization";
import { buildSlugline, parseSlugline } from "@/features/screenplay/lib/slugline";
import {
  ensureCurrentScriptVersion,
  getCurrentScriptVersion,
} from "@/features/screenplay/lib/versions";
import { prisma } from "@/shared/db/prisma";

export async function bootstrapScriptBlocks(
  projectId: string,
  createdById: string,
  versionId?: string,
) {
  const version =
    versionId != null
      ? await prisma.scriptVersion.findFirst({
          where: { id: versionId, projectId },
        })
      : await ensureCurrentScriptVersion(projectId, createdById);

  if (!version) return null;

  const existing = await prisma.scriptBlock.count({
    where: { scriptVersionId: version.id },
  });
  if (existing > 0) return version;

  const scenes = await prisma.scene.findMany({
    where: { projectId },
    include: {
      locations: { include: { location: true } },
      characters: { include: { character: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
  });

  const rows: Array<{
    projectId: string;
    scriptVersionId: string;
    sceneId: string | null;
    type: ScriptBlockType;
    content: string;
    sortOrder: number;
  }> = [];

  let order = 0;
  for (const scene of scenes) {
    const location = scene.locations[0]?.location.name ?? scene.summary ?? "";
    rows.push({
      projectId,
      scriptVersionId: version.id,
      sceneId: scene.id,
      type: "SLUGLINE",
      content: buildSlugline({
        episodeNumber: scene.episodeNumber,
        number: scene.number,
        postfix: scene.postfix,
        intExt: scene.intExt,
        dayNight: scene.dayNight,
        location,
      }),
      sortOrder: order++,
    });

    if (scene.characters.length > 0) {
      rows.push({
        projectId,
        scriptVersionId: version.id,
        sceneId: scene.id,
        type: "SCENE_CAST",
        content: scene.characters.map((c) => c.character.name).join(", "),
        sortOrder: order++,
      });
    }

    for (const block of scriptContentToBlocks(scene.scriptContent, scene.id, order)) {
      rows.push({
        projectId,
        scriptVersionId: version.id,
        sceneId: scene.id,
        type: block.type,
        content: block.content,
        sortOrder: block.sortOrder,
      });
      order = block.sortOrder + 1;
    }
  }

  if (rows.length > 0) {
    await prisma.scriptBlock.createMany({ data: rows });
  }

  return version;
}

export async function syncSluglineFromScene(projectId: string, sceneId: string) {
  const scene = await prisma.scene.findFirst({
    where: { id: sceneId, projectId },
    include: { locations: { include: { location: true } } },
  });
  if (!scene) return;

  const current = await getCurrentScriptVersion(projectId);
  if (!current) return;

  const slugline = buildSlugline({
    episodeNumber: scene.episodeNumber,
    number: scene.number,
    postfix: scene.postfix,
    intExt: scene.intExt,
    dayNight: scene.dayNight,
    location: scene.locations[0]?.location.name ?? scene.summary,
  });

  const block = await prisma.scriptBlock.findFirst({
    where: {
      sceneId,
      type: "SLUGLINE",
      scriptVersionId: current.id,
      projectId,
    },
    orderBy: { sortOrder: "asc" },
  });

  if (block) {
    await prisma.scriptBlock.update({
      where: { id: block.id, projectId },
      data: { content: slugline },
    });
  }
}

export async function applyImportScriptBlocks(
  projectId: string,
  scriptVersionId: string,
  sceneIdsInOrder: Array<string | null>,
  importBlocks: Array<{
    type: ScriptBlockType;
    content: string;
    sceneIndex: number;
    sortOrder: number;
  }>,
  sluglines: string[],
) {
  await prisma.scriptBlock.deleteMany({ where: { scriptVersionId } });

  const rows: Array<{
    projectId: string;
    scriptVersionId: string;
    sceneId: string | null;
    type: ScriptBlockType;
    content: string;
    sortOrder: number;
  }> = [];

  let order = 0;
  for (let i = 0; i < sluglines.length; i++) {
    const sceneId = sceneIdsInOrder[i] ?? null;

    rows.push({
      projectId,
      scriptVersionId,
      sceneId,
      type: "SLUGLINE",
      content: sluglines[i]!,
      sortOrder: order++,
    });

    const body = importBlocks.filter((b) => b.sceneIndex === i + 1);
    for (const block of body) {
      if (block.type === "SLUGLINE") continue;
      rows.push({
        projectId,
        scriptVersionId,
        sceneId,
        type: block.type,
        content: block.content,
        sortOrder: order++,
      });
    }
  }

  if (rows.length > 0) {
    await prisma.scriptBlock.createMany({ data: rows });
  }
}

export async function refreshAllSluglines(projectId: string) {
  const current = await getCurrentScriptVersion(projectId);
  if (!current) return;

  const scenes = await prisma.scene.findMany({
    where: { projectId },
    select: { id: true },
  });
  for (const scene of scenes) {
    await syncSluglineFromScene(projectId, scene.id);
  }
}

export async function linkBlocksToExistingScenes(
  projectId: string,
  blocks: ScreenplayBlock[],
): Promise<ScreenplayBlock[]> {
  const scenes = await prisma.scene.findMany({
    where: { projectId },
    select: {
      id: true,
      episodeNumber: true,
      number: true,
      postfix: true,
    },
  });

  const sceneKey = (episode: number, number: string, postfix: string) =>
    `${episode}:${number}:${postfix}`;

  const byKey = new Map(
    scenes.map((scene) => [
      sceneKey(scene.episodeNumber, scene.number, scene.postfix),
      scene.id,
    ]),
  );

  // sceneId из браузера оставляем, только если это сцена этого проекта.
  const projectSceneIds = new Set(scenes.map((scene) => scene.id));
  const trustedSceneId = (sceneId: string | null) =>
    sceneId && projectSceneIds.has(sceneId) ? sceneId : null;

  let currentSceneId: string | null = null;
  return blocks.map((block) => {
    const ownSceneId = trustedSceneId(block.sceneId);
    if (block.type === "SLUGLINE") {
      const parsed = parseSlugline(block.content);
      if (parsed) {
        const id =
          byKey.get(
            sceneKey(parsed.episodeNumber, parsed.number, parsed.postfix),
          ) ?? ownSceneId;
        currentSceneId = id ?? null;
        return { ...block, sceneId: id };
      }
    }
    return {
      ...block,
      sceneId: ownSceneId ?? currentSceneId,
    };
  });
}
