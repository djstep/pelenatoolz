import type { ScriptBlockType } from "@prisma/client";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import {
  blocksToScriptContent,
  extractCharacterNames,
  scriptContentToBlocks,
} from "@/features/screenplay/lib/block-serialization";
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

export async function syncSceneFromSlugline(
  projectId: string,
  sceneId: string,
  slugline: string,
) {
  const parsed = parseSlugline(slugline);
  if (!parsed) return;

  const locationName = parsed.location.trim();
  let locationId: string | undefined;
  if (locationName) {
    const loc =
      (await prisma.location.findFirst({
        where: { projectId, name: { equals: locationName, mode: "insensitive" } },
      })) ??
      (await prisma.location.create({
        data: { projectId, name: locationName },
      }));
    locationId = loc.id;
  }

  await prisma.scene.update({
    where: { id: sceneId },
    data: {
      episodeNumber: parsed.episodeNumber,
      number: parsed.number,
      postfix: parsed.postfix,
      intExt: parsed.intExt,
      dayNight: parsed.dayNight,
      summary: locationName || undefined,
    },
  });

  if (locationId) {
    await prisma.sceneLocation.deleteMany({ where: { sceneId } });
    await prisma.sceneLocation.create({ data: { sceneId, locationId } });
  }
}

export async function syncSceneCharactersFromBlocks(
  projectId: string,
  sceneId: string,
  blocks: ScreenplayBlock[],
) {
  const names = extractCharacterNames(blocks);
  const characterIds: string[] = [];

  for (const name of names) {
    const character =
      (await prisma.character.findFirst({
        where: { projectId, name: { equals: name, mode: "insensitive" } },
      })) ??
      (await prisma.character.create({ data: { projectId, name } }));
    characterIds.push(character.id);
  }

  await prisma.sceneCharacter.deleteMany({ where: { sceneId } });
  if (characterIds.length > 0) {
    await prisma.sceneCharacter.createMany({
      data: characterIds.map((characterId) => ({ sceneId, characterId })),
    });
  }
}

export async function syncSceneScriptContent(
  sceneId: string,
  blocks: ScreenplayBlock[],
) {
  const content = blocksToScriptContent(blocks);
  await prisma.scene.update({
    where: { id: sceneId },
    data: { scriptContent: content || null },
  });
}

export async function syncSluglineFromScene(sceneId: string) {
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: { locations: { include: { location: true } } },
  });
  if (!scene) return;

  const current = await getCurrentScriptVersion(scene.projectId);
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
    where: { sceneId, type: "SLUGLINE", scriptVersionId: current.id },
    orderBy: { sortOrder: "asc" },
  });

  if (block) {
    await prisma.scriptBlock.update({
      where: { id: block.id },
      data: { content: slugline },
    });
  }
}

export async function ensureScenesFromBlocks(
  projectId: string,
  blocks: ScreenplayBlock[],
): Promise<ScreenplayBlock[]> {
  const sorted = [...blocks].sort((a, b) => a.sortOrder - b.sortOrder);
  const result: ScreenplayBlock[] = [];
  let currentSceneId: string | null = null;

  for (const block of sorted) {
    if (block.type === "SLUGLINE") {
      if (!block.sceneId) {
        const parsed = parseSlugline(block.content);
        const maxOrder = await prisma.scene.aggregate({
          where: { projectId },
          _max: { sortOrder: true },
        });
        const scene = await prisma.scene.create({
          data: {
            projectId,
            episodeNumber: parsed?.episodeNumber ?? 0,
            number: parsed?.number ?? String((maxOrder._max.sortOrder ?? 0) + 1),
            postfix: parsed?.postfix ?? "",
            intExt: parsed?.intExt,
            dayNight: parsed?.dayNight,
            summary: parsed?.location,
            sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
          },
        });
        currentSceneId = scene.id;
        result.push({ ...block, sceneId: scene.id });
        if (parsed?.location) {
          await syncSceneFromSlugline(projectId, scene.id, block.content);
        }
      } else {
        currentSceneId = block.sceneId;
        result.push(block);
      }
      continue;
    }

    result.push({
      ...block,
      sceneId: block.sceneId ?? currentSceneId,
    });
  }

  return normalizeBlockSortOrders(result);
}

function normalizeBlockSortOrders(blocks: ScreenplayBlock[]) {
  return blocks.map((block, index) => ({ ...block, sortOrder: index }));
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

export async function syncAllScenesFromBlocks(
  projectId: string,
  blocks: ScreenplayBlock[],
) {
  const withSceneIds = await ensureScenesFromBlocks(projectId, blocks);
  const byScene = new Map<string, ScreenplayBlock[]>();
  let currentSceneId: string | null = null;

  for (const block of [...withSceneIds].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (block.type === "SLUGLINE" && block.sceneId) {
      currentSceneId = block.sceneId;
    }
    if (block.sceneId) currentSceneId = block.sceneId;
    if (!currentSceneId) continue;
    const list = byScene.get(currentSceneId) ?? [];
    list.push(block);
    byScene.set(currentSceneId, list);
  }

  for (const [sceneId, sceneBlocks] of byScene) {
    const slug = sceneBlocks.find((b) => b.type === "SLUGLINE");
    if (slug) {
      await syncSceneFromSlugline(projectId, sceneId, slug.content);
    }
    await syncSceneCharactersFromBlocks(projectId, sceneId, sceneBlocks);
    await syncSceneScriptContent(sceneId, sceneBlocks);
  }

  return withSceneIds;
}

export async function refreshAllSluglines(projectId: string) {
  const current = await getCurrentScriptVersion(projectId);
  if (!current) return;

  const scenes = await prisma.scene.findMany({
    where: { projectId },
    select: { id: true },
  });
  for (const scene of scenes) {
    await syncSluglineFromScene(scene.id);
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

  let currentSceneId: string | null = null;
  return blocks.map((block) => {
    if (block.type === "SLUGLINE") {
      const parsed = parseSlugline(block.content);
      if (parsed) {
        const id =
          byKey.get(
            sceneKey(parsed.episodeNumber, parsed.number, parsed.postfix),
          ) ?? block.sceneId;
        currentSceneId = id ?? null;
        return { ...block, sceneId: id ?? block.sceneId };
      }
    }
    return {
      ...block,
      sceneId: block.sceneId ?? currentSceneId,
    };
  });
}
