import type { Prisma, ProjectType } from "@prisma/client";
import { nextSceneNumber } from "@/features/import/normalize/text";
import type { Permission } from "@/features/memberships/permissions";
import { formatSceneNumber } from "@/features/script/lib/libretto-display";

/** Право на авто- и ручную перенумерацию сцен. */
export const SCENE_NUMBERS_WRITE_PERMISSION: Permission = "script:write";

export function sceneNumbersAccessRefusal(can: (permission: Permission) => boolean) {
  return can(SCENE_NUMBERS_WRITE_PERMISSION) ? null : "Недостаточно прав";
}

export type SceneNumberRow = {
  id: string;
  episodeNumber: number;
  number: string;
  postfix: string;
  cut: boolean;
};

export type SceneNumberInput = Pick<SceneNumberRow, "id" | "episodeNumber" | "number" | "postfix">;

/** Что записать сцене. `sortOrder: null` — порядок не меняется. */
export type SceneNumberChange = SceneNumberInput & { sortOrder: number | null };

function key(s: Pick<SceneNumberRow, "episodeNumber" | "number" | "postfix">) {
  return `${s.episodeNumber}|${s.number}|${s.postfix}`;
}

/**
 * Авто-перенумерация: живые сцены каждой серии получают 1, 2, 3… по текущему порядку
 * (`scenes` уже отсортированы), номера вырезанных пропускаются — вырезанная сцена
 * свой номер не меняет. Порядок (`sortOrder`) — позиция сцены в серии, вместе с вырезанными.
 * Возвращает только сцены, у которых что-то меняется.
 */
export function planAutoRenumber(
  scenes: readonly (SceneNumberRow & { sortOrder: number })[],
): SceneNumberChange[] {
  const cutKeys = new Set(scenes.filter((s) => s.cut).map(key));
  const counters = new Map<number, { number: number; position: number }>();
  const changes: SceneNumberChange[] = [];

  for (const scene of scenes) {
    const counter = counters.get(scene.episodeNumber) ?? { number: 0, position: 0 };
    counters.set(scene.episodeNumber, counter);
    counter.position += 1;

    let target = { episodeNumber: scene.episodeNumber, number: scene.number, postfix: scene.postfix };
    if (!scene.cut) {
      do {
        counter.number += 1;
        target = { episodeNumber: scene.episodeNumber, number: String(counter.number), postfix: "" };
      } while (cutKeys.has(key(target)));
    }

    if (key(target) !== key(scene) || counter.position !== scene.sortOrder) {
      changes.push({ id: scene.id, ...target, sortOrder: counter.position });
    }
  }
  return changes;
}

/**
 * Ручная перенумерация: проверка до записи. Номер вырезанной сцены не меняется и не отдаётся
 * другой сцене (подсказка — буква, как в импорте), повторы номеров — отказ.
 * Сцены, которых нет в `rows`, сохраняют номера.
 */
export function planManualRenumber(
  scenes: readonly SceneNumberRow[],
  rows: readonly SceneNumberInput[],
  projectType: ProjectType,
): { error: string } | { changes: SceneNumberChange[] } {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const final = new Map(scenes.map((s) => [s.id, s as SceneNumberInput]));
  const changes: SceneNumberChange[] = [];

  for (const row of rows) {
    const scene = byId.get(row.id);
    if (!scene) return { error: "Сцена не найдена" };
    if (key(row) === key(scene)) continue;
    if (scene.cut) {
      return {
        error: `Сцена ${formatSceneNumber(scene, projectType)} вырезана — её номер не меняется`,
      };
    }
    final.set(row.id, row);
    changes.push({ ...row, sortOrder: null });
  }

  const cutKeys = new Set(scenes.filter((s) => s.cut).map(key));
  for (const change of changes) {
    if (!cutKeys.has(key(change))) continue;
    const label = formatSceneNumber(change, projectType);
    const used = new Set(
      [...final.values()]
        .filter((s) => s.episodeNumber === change.episodeNumber)
        .map((s) => `${s.number}${s.postfix}`.toUpperCase()),
    );
    const letter = nextSceneNumber(`${change.number}${change.postfix}`, used);
    const example = letter
      ? formatSceneNumber({ ...change, number: letter, postfix: "" }, projectType)
      : null;
    return {
      error: example
        ? `Номер ${label} занят вырезанной сценой — например, ${example}`
        : `Номер ${label} занят вырезанной сценой — выберите другой`,
    };
  }

  const seen = new Set<string>();
  for (const s of final.values()) {
    if (seen.has(key(s))) {
      return { error: `Номер ${formatSceneNumber(s, projectType)} повторяется — проверьте уникальность` };
    }
    seen.add(key(s));
  }

  return { changes };
}

type NumbersDb = { $executeRaw: Prisma.TransactionClient["$executeRaw"] };

/**
 * Записывает номера в одной транзакции (вызывать внутри `$transaction`). Уникальный индекс
 * номера проверяется сразу на каждой строке, поэтому обмен 1 ↔ 2 одним проходом упал бы:
 * сначала меняющим номер сценам ставится временный номер `~id` (id уникален), затем — новый.
 */
export async function applySceneNumberChanges(
  tx: NumbersDb,
  projectId: string,
  changes: readonly SceneNumberChange[],
  current: readonly SceneNumberInput[],
) {
  if (changes.length === 0) return;
  const before = new Map(current.map((s) => [s.id, key(s)]));
  const renamed = changes.filter((c) => before.get(c.id) !== key(c)).map((c) => c.id);
  const now = new Date();

  if (renamed.length > 0) {
    await tx.$executeRaw`
      UPDATE "Scene" SET "number" = '~' || "id"
      WHERE "projectId" = ${projectId} AND "id" = ANY(${renamed}::text[])`;
  }
  await tx.$executeRaw`
    UPDATE "Scene" AS s SET
      "episodeNumber" = v.episode_number,
      "number" = v.number,
      "postfix" = v.postfix,
      "sortOrder" = COALESCE(v.sort_order, s."sortOrder"),
      "updatedAt" = ${now}::timestamp(3)
    FROM unnest(
      ${changes.map((c) => c.id)}::text[],
      ${changes.map((c) => c.episodeNumber)}::int[],
      ${changes.map((c) => c.number)}::text[],
      ${changes.map((c) => c.postfix)}::text[],
      ${changes.map((c) => c.sortOrder)}::int[]
    ) AS v(id, episode_number, number, postfix, sort_order)
    WHERE s."id" = v.id AND s."projectId" = ${projectId}`;
}
