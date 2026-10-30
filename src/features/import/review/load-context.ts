import "server-only";

import type { DictionaryRule } from "@/features/import/normalize/dictionary";
import { parseHeading } from "@/features/import/normalize/heading";
import { cleanText, compareKey } from "@/features/import/normalize/text";
import {
  contentHash,
  headingKey,
  type ExistingScene,
  type VersionScene,
} from "@/features/import/normalize/scene-match";
import { prisma } from "@/shared/db/prisma";

const INT_EXT_WORDS = { INT: "ИНТ.", EXT: "НАТ.", INT_EXT: "ИНТ./НАТ." } as const;
const DAY_NIGHT_WORDS = { DAY: "ДЕНЬ", NIGHT: "НОЧЬ", DAWN: "УТРО", DUSK: "ВЕЧЕР" } as const;

/**
 * Всё, что нормализации нужно из базы, — только чтение: словарь проекта, имена персонажей
 * и локаций проекта, сцены (для сопоставления с прошлой версией), текущая версия сценария,
 * режим хронометража.
 */
export async function loadImportContext(projectId: string) {
  const [rules, characters, locations, current, project, scenes] = await Promise.all([
    prisma.scriptDictionaryRule.findMany({
      where: { projectId },
      select: {
        type: true,
        key: true,
        answer: true,
        targetCharacterId: true,
        targetLocationId: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.character.findMany({
      where: { projectId },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.location.findMany({
      where: { projectId },
      select: { id: true, name: true, sublocation: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.scriptVersion.findFirst({
      where: { projectId, isCurrent: true },
      select: {
        id: true,
        blocks: {
          where: { type: "SLUGLINE", sceneId: { not: null } },
          select: { sceneId: true, content: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    }),
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { timingMode: true, pageToMinuteRatio: true },
    }),
    prisma.scene.findMany({
      where: { projectId },
      select: {
        id: true,
        episodeNumber: true,
        number: true,
        postfix: true,
        intExt: true,
        dayNight: true,
        cutAt: true,
        scriptContent: true,
        characters: { select: { characterId: true } },
        locations: { select: { locationId: true } },
        shootDayScenes: { select: { shootDay: { select: { dayNumber: true } } } },
        _count: { select: { productionFacts: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
    }),
  ]);

  const dictionary: DictionaryRule[] = rules.map((rule) => ({
    type: rule.type,
    key: rule.key,
    answer: rule.answer,
    target: rule.targetCharacterId
      ? { kind: "character", id: rule.targetCharacterId }
      : rule.targetLocationId
        ? { kind: "location", id: rule.targetLocationId }
        : null,
  }));

  const sluglines = new Map<string, string>();
  for (const block of current?.blocks ?? []) {
    if (block.sceneId && !sluglines.has(block.sceneId)) sluglines.set(block.sceneId, block.content);
  }
  // Шапки текущей версии со сценами — только сцены этого проекта (удалённые и чужие — нет).
  const projectSceneIds = new Set(scenes.map((s) => s.id));
  const versionScenes: VersionScene[] = (current?.blocks ?? []).flatMap((block) => {
    if (!block.sceneId || !projectSceneIds.has(block.sceneId)) return [];
    const number = parseHeading(cleanText(block.content)).number;
    return [
      {
        sceneId: block.sceneId,
        number: number ? compareKey(number) : null,
        key: headingKey(block.content),
      },
    ];
  });
  const locationById = new Map(locations.map((l) => [l.id, l]));

  const existingScenes: ExistingScene[] = scenes.map((scene) => {
    // Шапки в текущей версии нет — собираем из полей либретто.
    const places = scene.locations.flatMap(({ locationId }) => {
      const row = locationById.get(locationId);
      return row ? [row.sublocation ? `${row.name}. ${row.sublocation}` : row.name] : [];
    });
    const built = [
      scene.intExt ? INT_EXT_WORDS[scene.intExt] : null,
      places.join(" / ") || null,
      scene.dayNight ? `— ${DAY_NIGHT_WORDS[scene.dayNight]}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      id: scene.id,
      number: compareKey(
        `${scene.episodeNumber ? `${scene.episodeNumber}-` : ""}${scene.number}${scene.postfix}`,
      ),
      heading: sluglines.get(scene.id) ?? built,
      intExt: scene.intExt,
      dayNight: scene.dayNight,
      cut: scene.cutAt !== null,
      characterIds: scene.characters.map((c) => c.characterId),
      locationIds: scene.locations.map((l) => l.locationId),
      contentHash: contentHash(scene.scriptContent ?? ""),
      shootDays: scene.shootDayScenes.map((d) => d.shootDay.dayNumber).sort((a, b) => a - b),
      reportFacts: scene._count.productionFacts,
    };
  });

  return {
    dictionary,
    existing: { characters, locations, scenes: existingScenes, versionScenes },
    currentVersionId: current?.id ?? null,
    timing: {
      mode: project.timingMode,
      pageToMinuteRatio: Number(project.pageToMinuteRatio) || 1,
    },
  };
}
