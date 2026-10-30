import type { DayNight, IntExt, ScriptBlockType, TimingMode } from "@prisma/client";
import {
  rulesFromAnswers,
  type DictionaryRuleDraft,
} from "@/features/import/normalize/dictionary";
import type {
  Answers,
  ExistingRecords,
  NormalizedScript,
} from "@/features/import/normalize/normalize-script";
import { sceneContent } from "@/features/import/normalize/scene-match";
import { compareKey } from "@/features/import/normalize/text";
import type { TitlePage } from "@/features/import/normalize/title-page";
import { previewTimings } from "@/features/import/review/timing";

/** Запись проекта: существующая (id) или создаётся этим импортом (ключ в плане). */
export type PlanRef = { id: string } | { key: string };

export type PlanScene = {
  /** Индекс сцены файла. */
  index: number;
  existingId: string | null;
  /** У новой — номер и буква: «11» + «А». У совпавшей — не меняется. */
  number: string;
  postfix: string;
  /** Пусто — у совпавшей остаётся как было. */
  intExt: IntExt | null;
  dayNight: DayNight | null;
  scriptContent: string | null;
  /** Только у новой сцены: хронометраж совпавших не пересчитывается. */
  planSeconds: number | null;
  sortOrder: number;
  restore: boolean;
  characters: PlanRef[];
  locations: PlanRef[];
  removeCharacterIds: string[];
  removeLocationIds: string[];
};

/** Сцена проекта, которой нет в новой версии: порядок и, по ответу, «вырезана». */
export type PlanMissingScene = { id: string; sortOrder: number; cut: boolean };

export type ImportPlan = {
  titlePage: TitlePage | null;
  characters: { key: string; name: string }[];
  locations: { key: string; name: string; sublocation: string | null }[];
  scenes: PlanScene[];
  missing: PlanMissingScene[];
  /** Блоки версии по порядку; `scene` — индекс сцены файла. */
  blocks: { type: ScriptBlockType; content: string; scene: number | null }[];
  /** Цель «по имени» — запись, которую создаёт этот импорт. */
  rules: DictionaryRuleDraft[];
};

export type TitleEdits = Partial<Record<Exclude<keyof TitlePage, "other" | "contacts">, string>>;

/** Почему импорт нельзя записать: обязательные вопросы без ответа. */
export function blockingQuestions(result: NormalizedScript) {
  // Совпавшая сцена ждёт ответа только из обязательного вопроса — его уже посчитали;
  // новая — когда для неё не нашлось номера.
  return (
    result.questions.filter((q) => q.required && !q.answer).length +
    result.sceneMatches.filter((m) => m.pending && !m.existingId).length
  );
}

export function applyTitleEdits(page: TitlePage | null, edits: TitleEdits): TitlePage | null {
  if (!page) return null;
  const next = { ...page };
  for (const [key, value] of Object.entries(edits) as [keyof TitleEdits, string][]) {
    next[key] = value.trim() || null;
  }
  return next;
}

/** «11А» → «11» и «А». */
export function splitSceneNumber(number: string) {
  const match = compareKey(number).match(/^(\d+)(\p{L}?)$/u);
  return match ? { number: match[1]!, postfix: match[2]! } : { number, postfix: "" };
}

const placeKey = (name: string, sub: string | null) =>
  `${compareKey(name)}|${sub ? compareKey(sub) : ""}`;

/**
 * План записи импорта. Чистая функция: сцены, персонажи, локации не удаляются; новые
 * записи — по ключу, id они получат при записи. Порядок сцен — по новой версии,
 * сцены проекта, которых нет в файле, — сразу после предыдущей.
 */
export function planImport(
  result: NormalizedScript,
  answers: Answers,
  existing: ExistingRecords,
  timing: { mode: TimingMode; pageToMinuteRatio: number },
  titleEdits: TitleEdits = {},
): ImportPlan {
  const characters = new Map<string, { key: string; name: string }>();
  const characterRef = new Map<string, PlanRef>();
  for (const c of result.characters) {
    if (c.existingId) {
      characterRef.set(c.key, { id: c.existingId });
    } else {
      characters.set(c.key, { key: c.key, name: c.name });
      characterRef.set(c.key, { key: c.key });
    }
  }

  const rows = new Map(existing.locations.map((l) => [placeKey(l.name, l.sublocation), l.id]));
  const locations = new Map<string, ImportPlan["locations"][number]>();
  const locationRef = (object: string, sub: string | null): PlanRef => {
    const key = placeKey(object, sub);
    const id = rows.get(key);
    if (id) return { id };
    if (!locations.has(key)) locations.set(key, { key, name: object, sublocation: sub });
    return { key };
  };

  const timings = previewTimings(result, timing.mode, timing.pageToMinuteRatio);
  const sceneBlocks = new Map<number, { type: ScriptBlockType; text: string }[]>();
  for (const b of result.blocks) {
    if (b.sceneIndex == null || b.type === "SLUGLINE") continue;
    sceneBlocks.set(b.sceneIndex, [...(sceneBlocks.get(b.sceneIndex) ?? []), b]);
  }

  const scenes: PlanScene[] = result.scenes.map((scene) => {
    const match = result.sceneMatches[scene.index]!;
    const { number, postfix } = splitSceneNumber(match.number ?? "");
    const isNew = !match.existingId;
    return {
      index: scene.index,
      existingId: match.existingId,
      number,
      postfix,
      intExt: scene.intExt,
      dayNight: scene.dayNight,
      scriptContent: sceneContent(sceneBlocks.get(scene.index) ?? []) || null,
      planSeconds:
        isNew && timing.mode !== "MANUAL" ? (timings.scenes[scene.index]?.seconds ?? null) : null,
      sortOrder: 0,
      restore: match.restore,
      characters: scene.characters.flatMap((key) => {
        const ref = characterRef.get(key);
        return ref ? [ref] : [];
      }),
      locations: scene.locations.map((l) => locationRef(l.object, l.sub)),
      removeCharacterIds: match.removeCharacterIds,
      removeLocationIds: match.removeLocationIds,
    };
  });

  // Порядок: сцены файла, а сцены проекта без пары — после предыдущей по старому порядку.
  type Slot = { scene: PlanScene } | { missing: PlanMissingScene };
  const order: Slot[] = scenes.map((scene) => ({ scene }));
  const placedAt = (id: string) =>
    order.findIndex((slot) =>
      "scene" in slot ? slot.scene.existingId === id : slot.missing.id === id,
    );
  const oldOrder = existing.scenes ?? [];
  const missingIds = new Map(result.missingScenes.map((m) => [m.existingId, m]));
  let head = 0;
  oldOrder.forEach((old, i) => {
    const missing = missingIds.get(old.id);
    if (!missing) return;
    const slot = { missing: { id: old.id, sortOrder: 0, cut: missing.cut } };
    let anchor = -1;
    for (let j = i - 1; j >= 0 && anchor < 0; j--) anchor = placedAt(oldOrder[j]!.id);
    if (anchor < 0) order.splice(head++, 0, slot);
    else order.splice(anchor + 1, 0, slot);
  });
  order.forEach((slot, i) => {
    if ("scene" in slot) slot.scene.sortOrder = i + 1;
    else slot.missing.sortOrder = i + 1;
  });

  return {
    titlePage: applyTitleEdits(result.titlePage, titleEdits),
    characters: [...characters.values()],
    locations: [...locations.values()],
    scenes,
    missing: order.flatMap((slot) => ("missing" in slot ? [slot.missing] : [])),
    blocks: result.blocks.map((b) => ({ type: b.type, content: b.text, scene: b.sceneIndex })),
    rules: rulesFromAnswers(result, answers),
  };
}
