import "server-only";

import type { DictionaryRule } from "@/features/import/normalize/dictionary";
import { prisma } from "@/shared/db/prisma";

/**
 * Всё, что нормализации нужно из базы, — только чтение: словарь проекта, имена персонажей
 * и локаций проекта, текущая версия сценария, режим хронометража.
 */
export async function loadImportContext(projectId: string) {
  const [rules, characters, locations, current, project] = await Promise.all([
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
      select: { id: true },
    }),
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { timingMode: true, pageToMinuteRatio: true },
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

  return {
    dictionary,
    existing: { characters, locations },
    currentVersionId: current?.id ?? null,
    timing: {
      mode: project.timingMode,
      pageToMinuteRatio: Number(project.pageToMinuteRatio) || 1,
    },
  };
}
