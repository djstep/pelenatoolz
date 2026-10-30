import "server-only";

import { Prisma, type ScriptVersionSourceType } from "@prisma/client";
import type { DictionaryRuleDraft } from "@/features/import/normalize/dictionary";
import { QUESTION_TYPES } from "@/features/import/normalize/normalize-script";
import { compareKey } from "@/features/import/normalize/text";
import type { ImportPlan, PlanRef } from "@/features/import/write/plan";
import { assertInProject } from "@/features/memberships/assert-in-project";
import { prisma } from "@/shared/db/prisma";

/**
 * Транзакция записи сценария. По умолчанию у Prisma 5 с на всю транзакцию и 2 с на ожидание
 * соединения; запрос к тестовой базе — 0,3–0,6 с, запросов около 15. Лимит функции на Vercel —
 * в отчёте шага 6.
 */
export const SCRIPT_WRITE_TX = { timeout: 60_000, maxWait: 10_000 } as const;

/** Текущая версия сценария сменилась с момента предпросмотра (двойное нажатие, вторая вкладка). */
export class ScriptVersionConflictError extends Error {
  constructor() {
    super("Сценарий уже изменился");
    this.name = "ScriptVersionConflictError";
  }
}

export function isScriptVersionConflictError(error: unknown): error is ScriptVersionConflictError {
  if (error instanceof ScriptVersionConflictError) return true;
  // Две записи успели взять один номер версии — тот же случай.
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    String(error.meta?.target ?? "").includes("versionNumber")
  );
}

export type ScriptWriteInput = {
  projectId: string;
  userId: string;
  /** Текущая версия на момент предпросмотра; сменилась — отказ. */
  expectedVersionId: string | null;
  version: { title: string | null; sourceType: ScriptVersionSourceType };
  plan: ImportPlan;
};

export type ScriptWriteResult = {
  versionId: string;
  versionNumber: number;
  scenesCreated: number;
  scenesMatched: number;
  scenesCut: number;
  scenesRestored: number;
  charactersCreated: number;
  locationsCreated: number;
  linksRemoved: number;
  rules: number;
  /** Запросов к базе в транзакции — для замера. */
  queries: number;
};

const CHUNK = 1000;

function chunks<T>(list: T[], size = CHUNK) {
  const result: T[][] = [];
  for (let i = 0; i < list.length; i += size) result.push(list.slice(i, i + size));
  return result;
}

/** Правилу склейки, подобъекта и выбора записи нужна цель: без неё правило не пишется. */
function needsTarget(rule: DictionaryRuleDraft) {
  switch (rule.type) {
    case QUESTION_TYPES.similarCharacters:
    case QUESTION_TYPES.similarLocations:
      return rule.answer !== "different";
    case QUESTION_TYPES.recordCharacter:
    case QUESTION_TYPES.recordLocation:
      return true;
    default:
      return false;
  }
}

/**
 * Одна точка записи сценария: версия с титульной, блоки, сцены, связи, новые персонажи
 * и локации, правила словаря — в одной транзакции, пачками. Сцены, персонажи и локации
 * не удаляются; убираются только связи, на которые ответили «убрать». `contentHtml` не пишется.
 */
export async function writeScript(input: ScriptWriteInput): Promise<ScriptWriteResult> {
  const { projectId, plan } = input;
  let queries = 0;
  const q = <T>(promise: Promise<T>) => {
    queries += 1;
    return promise;
  };

  return prisma.$transaction(async (tx) => {
    // Вторая запись того же проекта ждёт здесь и потом видит новую текущую версию.
    await q(tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`);
    const current = await q(
      tx.scriptVersion.findFirst({
        where: { projectId, isCurrent: true },
        select: { id: true },
      }),
    );
    if ((current?.id ?? null) !== input.expectedVersionId) {
      throw new ScriptVersionConflictError();
    }
    const last = await q(
      tx.scriptVersion.aggregate({ where: { projectId }, _max: { versionNumber: true } }),
    );
    if (current) {
      await q(
        tx.scriptVersion.updateMany({
          where: { projectId, isCurrent: true },
          data: { isCurrent: false },
        }),
      );
    }
    const version = await q(
      tx.scriptVersion.create({
        data: {
          projectId,
          versionNumber: (last._max.versionNumber ?? 0) + 1,
          title: input.version.title?.trim().slice(0, 200) || null,
          isCurrent: true,
          sourceType: input.version.sourceType,
          createdById: input.userId,
          ...(plan.titlePage ? { titlePage: plan.titlePage } : {}),
        },
        select: { id: true, versionNumber: true },
      }),
    );

    // Новые персонажи и строки локаций: ключ плана → id.
    const characterIds = new Map<string, string>();
    if (plan.characters.length > 0) {
      const created = await q(
        tx.character.createManyAndReturn({
          data: plan.characters.map((c) => ({ projectId, name: c.name })),
          select: { id: true, name: true },
        }),
      );
      const byName = new Map(created.map((c) => [compareKey(c.name), c.id]));
      for (const c of plan.characters) characterIds.set(c.key, byName.get(compareKey(c.name))!);
    }
    const locationIds = new Map<string, string>();
    const createdLocations: { id: string; name: string; sublocation: string | null }[] = [];
    if (plan.locations.length > 0) {
      const created = await q(
        tx.location.createManyAndReturn({
          data: plan.locations.map((l) => ({
            projectId,
            name: l.name,
            sublocation: l.sublocation,
          })),
          select: { id: true, name: true, sublocation: true },
        }),
      );
      createdLocations.push(...created);
      const byKey = new Map(
        created.map((l) => [`${compareKey(l.name)}|${l.sublocation ? compareKey(l.sublocation) : ""}`, l.id]),
      );
      for (const l of plan.locations) locationIds.set(l.key, byKey.get(l.key)!);
    }
    const characterId = (ref: PlanRef) => ("id" in ref ? ref.id : characterIds.get(ref.key)!);
    const locationId = (ref: PlanRef) => ("id" in ref ? ref.id : locationIds.get(ref.key)!);

    // Новые сцены.
    const sceneIds = new Map<number, string>();
    const fresh = plan.scenes.filter((s) => !s.existingId);
    if (fresh.length > 0) {
      const created = await q(
        tx.scene.createManyAndReturn({
          data: fresh.map((s) => ({
            projectId,
            number: s.number,
            postfix: s.postfix,
            intExt: s.intExt,
            dayNight: s.dayNight,
            scriptContent: s.scriptContent,
            planSeconds: s.planSeconds,
            sortOrder: s.sortOrder,
          })),
          select: { id: true, number: true, postfix: true },
        }),
      );
      const byNumber = new Map(created.map((s) => [`${s.number}|${s.postfix}`, s.id]));
      for (const s of fresh) sceneIds.set(s.index, byNumber.get(`${s.number}|${s.postfix}`)!);
    }
    for (const s of plan.scenes) if (s.existingId) sceneIds.set(s.index, s.existingId);

    // Сцены проекта — одним запросом: порядок, ИНТ/НАТ и режим (пусто — как было),
    // текст сцены у совпавших, «вырезана» / «вернуть» по ответу. Номера не меняются.
    const now = new Date();
    const updates = [
      ...plan.scenes.flatMap((s) =>
        s.existingId
          ? [
              {
                id: s.existingId,
                sortOrder: s.sortOrder,
                intExt: s.intExt,
                dayNight: s.dayNight,
                setContent: true,
                content: s.scriptContent,
                cut: s.restore ? "restore" : null,
              },
            ]
          : [],
      ),
      ...plan.missing.map((m) => ({
        id: m.id,
        sortOrder: m.sortOrder,
        intExt: null,
        dayNight: null,
        setContent: false,
        content: null,
        cut: m.cut ? "cut" : null,
      })),
    ];
    for (const part of chunks(updates, 500)) {
      const values = Prisma.join(
        part.map(
          (u) =>
            Prisma.sql`(${u.id}, ${u.sortOrder}::int, ${u.intExt}::text, ${u.dayNight}::text, ${u.setContent}::boolean, ${u.content}::text, ${u.cut}::text)`,
        ),
      );
      await q(tx.$executeRaw`
        UPDATE "Scene" AS s SET
          "sortOrder" = v.sort_order,
          "intExt" = COALESCE(v.int_ext::"IntExt", s."intExt"),
          "dayNight" = COALESCE(v.day_night::"DayNight", s."dayNight"),
          "scriptContent" = CASE WHEN v.set_content THEN v.content ELSE s."scriptContent" END,
          "cutAt" = CASE v.cut
            WHEN 'cut' THEN COALESCE(s."cutAt", ${now}::timestamp(3))
            WHEN 'restore' THEN NULL
            ELSE s."cutAt" END,
          "updatedAt" = ${now}::timestamp(3)
        FROM (VALUES ${values}) AS v(id, sort_order, int_ext, day_night, set_content, content, cut)
        WHERE s."id" = v.id AND s."projectId" = ${projectId}`);
    }

    // Связи: убрать — только по ответу; добавить — все из новой версии (повторы пропускаются).
    const unlinkCharacters = plan.scenes.flatMap((s) =>
      s.removeCharacterIds.map((id) => ({ sceneId: s.existingId!, characterId: id })),
    );
    const unlinkLocations = plan.scenes.flatMap((s) =>
      s.removeLocationIds.map((id) => ({ sceneId: s.existingId!, locationId: id })),
    );
    if (unlinkCharacters.length > 0) {
      await q(
        tx.sceneCharacter.deleteMany({
          where: { OR: unlinkCharacters, scene: { projectId } },
        }),
      );
    }
    if (unlinkLocations.length > 0) {
      await q(
        tx.sceneLocation.deleteMany({
          where: { OR: unlinkLocations, scene: { projectId } },
        }),
      );
    }
    const characterLinks = plan.scenes.flatMap((s) =>
      s.characters.map((ref) => ({ sceneId: sceneIds.get(s.index)!, characterId: characterId(ref) })),
    );
    const locationLinks = plan.scenes.flatMap((s) =>
      s.locations.map((ref) => ({ sceneId: sceneIds.get(s.index)!, locationId: locationId(ref) })),
    );
    for (const part of chunks(characterLinks)) {
      await q(tx.sceneCharacter.createMany({ data: part, skipDuplicates: true }));
    }
    for (const part of chunks(locationLinks)) {
      await q(tx.sceneLocation.createMany({ data: part, skipDuplicates: true }));
    }

    // Блоки версии — только текст.
    const blocks = plan.blocks.map((b, sortOrder) => ({
      projectId,
      scriptVersionId: version.id,
      sceneId: b.scene != null ? (sceneIds.get(b.scene) ?? null) : null,
      type: b.type,
      content: b.content,
      sortOrder,
    }));
    for (const part of chunks(blocks)) {
      await q(tx.scriptBlock.createMany({ data: part }));
    }

    // Словарь: цель «по имени» → id записи, созданной выше (у объекта — строка без
    // подобъекта, если есть). Без цели правило не пишется.
    const createdByName = {
      character: new Map(plan.characters.map((c) => [compareKey(c.name), characterIds.get(c.key)!])),
      location: new Map<string, string>(),
    };
    for (const l of [...createdLocations].sort(
      (a, b) => Number(a.sublocation != null) - Number(b.sublocation != null),
    )) {
      if (!createdByName.location.has(compareKey(l.name))) {
        createdByName.location.set(compareKey(l.name), l.id);
      }
    }
    const rules = plan.rules.flatMap((rule) => {
      let target: { kind: "character" | "location"; id: string } | null = null;
      if (rule.target && "id" in rule.target) {
        target = rule.target;
      } else if (rule.target) {
        const id = createdByName[rule.target.kind].get(compareKey(rule.target.name));
        if (id) target = { kind: rule.target.kind, id };
      }
      if (!target && needsTarget(rule)) return [];
      return [
        {
          projectId,
          type: rule.type,
          key: rule.key,
          answer: rule.answer,
          targetCharacterId: target?.kind === "character" ? target.id : null,
          targetLocationId: target?.kind === "location" ? target.id : null,
        },
      ];
    });
    if (rules.length > 0) {
      const characterTargets = rules.flatMap((r) => (r.targetCharacterId ? [r.targetCharacterId] : []));
      const locationTargets = rules.flatMap((r) => (r.targetLocationId ? [r.targetLocationId] : []));
      if (characterTargets.length > 0) {
        queries += 1;
        await assertInProject("Character", characterTargets, projectId, tx);
      }
      if (locationTargets.length > 0) {
        queries += 1;
        await assertInProject("Location", locationTargets, projectId, tx);
      }
      // Устаревшее правило с тем же ключом заменяется новым ответом.
      await q(
        tx.scriptDictionaryRule.deleteMany({
          where: { projectId, OR: rules.map((r) => ({ type: r.type, key: r.key })) },
        }),
      );
      await q(tx.scriptDictionaryRule.createMany({ data: rules }));
    }

    return {
      versionId: version.id,
      versionNumber: version.versionNumber,
      scenesCreated: fresh.length,
      scenesMatched: plan.scenes.length - fresh.length,
      scenesCut: plan.missing.filter((m) => m.cut).length,
      scenesRestored: plan.scenes.filter((s) => s.restore).length,
      charactersCreated: plan.characters.length,
      locationsCreated: plan.locations.length,
      linksRemoved: unlinkCharacters.length + unlinkLocations.length,
      rules: rules.length,
      queries,
    };
  }, SCRIPT_WRITE_TX);
}
