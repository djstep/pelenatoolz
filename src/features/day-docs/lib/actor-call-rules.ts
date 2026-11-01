import type { ActorTransportMode } from "@prisma/client";
import { saveActorCallsSchema } from "@/features/day-docs/schemas";

/**
 * Тайминги актёров дня: проверки сохранения — чистая функция (без базы), действие
 * `saveActorCallsAction` вызывает именно её. Права — как у всех таймингов: правка вызывного.
 * Подача машины хранится только при транспорте «машина»: сменили режим на «сам» или
 * «свой текст» (или убрали) — время подачи стирается.
 */

export const NO_RIGHTS = "Недостаточно прав";
export const DAY_NOT_FOUND = "Съёмочный день не найден";
export const ACTOR_NOT_FOUND = "Объект не найден";
export const BAD_FORMAT = "Некорректный формат";

export type ActorCallsDeps = {
  /** «КПП и вызывные: правка» (или правка вызывных). */
  canEdit: boolean;
  /** День — этого проекта. */
  dayInProject: (dayId: string) => Promise<boolean>;
  /** Все актёры — этого проекта. */
  actorsInProject: (actorIds: string[]) => Promise<boolean>;
};

export type ActorCallWrite = {
  actorId: string;
  pickupTime: string | null;
  arrivalTime: string | null;
  makeupTime: string | null;
  costumeTime: string | null;
  readyTime: string | null;
  wrapTime: string | null;
  transportMode: ActorTransportMode | null;
  transportText: string | null;
  carPickupTime: string | null;
};

function emptyToNull(v: string | undefined | null) {
  const t = v?.trim();
  return t ? t : null;
}

/** Строка для записи: свой текст — только у «свой текст», подача машины — только у «машина». */
export function actorCallWrite(row: {
  actorId: string;
  pickupTime?: string;
  arrivalTime?: string;
  makeupTime?: string;
  costumeTime?: string;
  readyTime?: string;
  wrapTime?: string;
  transportMode?: ActorTransportMode | "" | null;
  transportText?: string;
  carPickupTime?: string;
}): ActorCallWrite {
  const transportMode = row.transportMode || null;
  return {
    actorId: row.actorId,
    pickupTime: emptyToNull(row.pickupTime),
    arrivalTime: emptyToNull(row.arrivalTime),
    makeupTime: emptyToNull(row.makeupTime),
    costumeTime: emptyToNull(row.costumeTime),
    readyTime: emptyToNull(row.readyTime),
    wrapTime: emptyToNull(row.wrapTime),
    transportMode,
    transportText: transportMode === "CUSTOM" ? emptyToNull(row.transportText) : null,
    carPickupTime: transportMode === "CAR" ? emptyToNull(row.carPickupTime) : null,
  };
}

function hasData(row: ActorCallWrite) {
  return Boolean(
    row.pickupTime ||
      row.arrivalTime ||
      row.makeupTime ||
      row.costumeTime ||
      row.readyTime ||
      row.wrapTime ||
      row.transportMode,
  );
}

/**
 * Проверки до первой записи: право правки, день и актёры — этого проекта, формат строк.
 * Возвращает строки для записи (пустые строки — без записи).
 */
export async function checkActorCallsSave(
  deps: ActorCallsDeps,
  dayId: unknown,
  raw: unknown,
): Promise<{ rows: ActorCallWrite[] } | { error: string }> {
  if (!deps.canEdit) return { error: NO_RIGHTS };
  if (typeof dayId !== "string" || dayId.trim() === "" || dayId.length > 100) {
    return { error: DAY_NOT_FOUND };
  }
  if (!(await deps.dayInProject(dayId))) return { error: DAY_NOT_FOUND };

  let rows: unknown;
  try {
    rows = JSON.parse(typeof raw === "string" ? raw : "[]");
  } catch {
    return { error: BAD_FORMAT };
  }
  const parsed = saveActorCallsSchema.safeParse({ rows });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте тайминги актёров" };
  }

  const actorIds = [...new Set(parsed.data.rows.map((row) => row.actorId))];
  if (actorIds.length > 0 && !(await deps.actorsInProject(actorIds))) {
    return { error: ACTOR_NOT_FOUND };
  }
  return { rows: parsed.data.rows.map(actorCallWrite).filter(hasData) };
}
