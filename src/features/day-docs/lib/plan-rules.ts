import type { CallSheetUnit, TimeSlotType } from "@prisma/client";
import { formatSceneNumber } from "@/features/day-docs/lib/build-day-doc";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import { saveTimeSlotsSchema } from "@/features/day-docs/schemas";

/**
 * Правила плана вызывного (строки ShootDayTimeSlot): проверки сохранения и подписи строк.
 * Чистые функции — действие `saveTimeSlotsAction` вызывает именно их, тесты — без базы.
 */

type SceneNumberParts = { number: string; postfix: string; episodeNumber: number };

/** Сцена вырезана: `Scene.cutAt` заполнено. */
export function isSceneCut(scene: { cutAt?: Date | string | null } | null | undefined): boolean {
  return Boolean(scene?.cutAt);
}

export const BAD_PLAN_FORMAT = "Некорректный формат расписания";
export const PLAN_SCENE_NOT_FOUND = "Сцена не найдена в проекте";
export const CONTINUATION_NEEDS_SCENE =
  "«Продолжение сцены» можно поставить только у строки со сценой";

export function cutSceneInPlanError(scene: SceneNumberParts): string {
  return `Сцена ${formatSceneNumber(scene)} вырезана — её нельзя поставить в план`;
}

export function cutSceneInDayWarning(scene: SceneNumberParts): string {
  return `В дне КПП стоит вырезанная сцена ${formatSceneNumber(scene)} — уберите её из дня в КПП`;
}

export function continuationTitle(scene: SceneNumberParts): string {
  return `Продолжение сцены ${formatSceneNumber(scene)}`;
}

/** Предупреждения экрана правки: по одному на каждую вырезанную сцену дня КПП. */
export function cutSceneWarnings(
  dayScenes: Array<{ scene: SceneNumberParts & { cutAt?: Date | string | null } }>,
): string[] {
  return dayScenes.filter((row) => isSceneCut(row.scene)).map((row) => cutSceneInDayWarning(row.scene));
}

/** Что сервер знает о сценах строк плана (для проверки «вырезана»). */
export type PlanSceneFacts = SceneNumberParts & { id: string; cutAt: Date | string | null };

export type PlanRulesDeps = {
  /** Все id — сцены этого проекта. false — чужая или нет записи. */
  inProject: (sceneIds: string[]) => Promise<boolean>;
  /** Сцены по id (уже проверенные на проект). */
  loadScenes: (sceneIds: string[]) => Promise<PlanSceneFacts[]>;
};

/** Строка плана, готовая к записи в базу. */
export type TimeSlotSaveRow = {
  startTime: string;
  endTime: string | null;
  slotType: TimeSlotType;
  sceneId: string | null;
  notes: string | null;
  unit: CallSheetUnit;
  isContinuation: boolean;
  customLabel: string | null;
  sortOrder: number;
};

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Разбор строк плана из формы (JSON). Новые поля не переданы — умолчания (MAIN / false / null). */
export function parseTimeSlotRows(
  raw: unknown,
): { rows: TimeSlotSaveRow[] } | { error: string } {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw === "" ? "[]" : raw);
    } catch {
      return { error: BAD_PLAN_FORMAT };
    }
  }
  const parsed = saveTimeSlotsSchema.safeParse({ rows: value });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте строки плана" };
  }
  const rows = parsed.data.rows.map((row, index) => ({
    startTime: row.startTime,
    endTime: emptyToNull(row.endTime),
    slotType: row.slotType,
    sceneId: row.sceneId || null,
    notes: emptyToNull(row.notes),
    unit: row.unit,
    isContinuation: row.isContinuation,
    customLabel: emptyToNull(row.customLabel),
    sortOrder: index,
  }));
  if (rows.some((row) => row.isContinuation && !row.sceneId)) {
    return { error: CONTINUATION_NEEDS_SCENE };
  }
  return { rows };
}

/**
 * Проверки сохранения плана до записи: формат, «продолжение» только со сценой,
 * сцены — этого проекта, вырезанную сцену поставить нельзя (в любом юните).
 */
export async function checkTimeSlotsSave(
  deps: PlanRulesDeps,
  raw: unknown,
): Promise<{ rows: TimeSlotSaveRow[] } | { error: string }> {
  const parsed = parseTimeSlotRows(raw);
  if ("error" in parsed) return parsed;

  const sceneIds = [
    ...new Set(parsed.rows.map((row) => row.sceneId).filter((id): id is string => Boolean(id))),
  ];
  if (sceneIds.length === 0) return parsed;

  if (!(await deps.inProject(sceneIds))) return { error: PLAN_SCENE_NOT_FOUND };

  const scenes = await deps.loadScenes(sceneIds);
  const byId = new Map(scenes.map((scene) => [scene.id, scene] as const));
  for (const row of parsed.rows) {
    const scene = row.sceneId ? byId.get(row.sceneId) : undefined;
    if (row.sceneId && !scene) return { error: PLAN_SCENE_NOT_FOUND };
    if (scene && isSceneCut(scene)) return { error: cutSceneInPlanError(scene) };
  }
  return parsed;
}

/** Свой текст строки: пусто или совпадает с названием типа — не храним. */
export function breakCustomLabel(slotType: TimeSlotType, label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed || trimmed === timeSlotTypeLabels[slotType]) return null;
  return trimmed;
}

/** Разделитель, которым раньше склеивали подпись и примечание служебной строки в notes. */
const LEGACY_SEPARATOR = " — ";

/**
 * Подпись и примечание служебной строки для правки.
 * Есть customLabel — берём как есть. Иначе подпись — название типа, notes — примечание целиком
 * (старые строки, где подпись склеена в notes, остаются как были). Только явная старая склейка
 * «Название типа — примечание» (или notes, равное названию типа) разбирается обратно,
 * чтобы название не дублировалось.
 */
export function breakFieldsFromSlot(slot: {
  slotType: TimeSlotType;
  notes: string | null;
  customLabel?: string | null;
}): { label: string; notes: string } {
  const typeLabel = timeSlotTypeLabels[slot.slotType];
  const notes = slot.notes?.trim() ?? "";
  if (slot.customLabel?.trim()) {
    return { label: slot.customLabel.trim(), notes };
  }
  if (notes === typeLabel) return { label: typeLabel, notes: "" };
  const legacyPrefix = `${typeLabel}${LEGACY_SEPARATOR}`;
  if (notes.startsWith(legacyPrefix)) {
    return { label: typeLabel, notes: notes.slice(legacyPrefix.length).trim() };
  }
  return { label: typeLabel, notes };
}

/**
 * Подпись строки плана для показа: заголовок и примечание.
 * Сцена-продолжение — «Продолжение сцены N»; свой текст — вместо названия типа.
 * Старые строки (без customLabel) — как раньше: название типа и notes целиком.
 */
export function describePlanSlot(slot: {
  slotType: TimeSlotType;
  notes: string | null;
  customLabel?: string | null;
  isContinuation?: boolean;
  scene?: SceneNumberParts | null;
}): { title: string; notes: string | null } {
  const notes = slot.notes?.trim() || null;
  if (slot.scene && slot.isContinuation) {
    return { title: slot.customLabel?.trim() || continuationTitle(slot.scene), notes };
  }
  return { title: slot.customLabel?.trim() || timeSlotTypeLabels[slot.slotType], notes };
}
