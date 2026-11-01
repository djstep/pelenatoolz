import { createHash } from "node:crypto";
import type { CallSheetBlocks } from "@/features/call-sheets/queries";
import type { ElementsEditorData } from "@/features/call-sheets/elements-queries";
import {
  buildCallSheetPrintModel,
  type CallSheetPrintModel,
  type CallSheetPrintSource,
} from "@/features/call-sheets/print/print-model";
import type { DayAstro } from "@/features/day-docs/lib/city-astro";
import type { DayDocBundle } from "@/features/day-docs/lib/build-day-doc";
import { NO_RIGHTS, DAY_NOT_FOUND } from "@/features/call-sheets/lib/template-rules";

/**
 * Данные страницы вызывного → вход модели листа. Одна сборка для просмотра на странице,
 * печати и Excel: что видно на экране, то и печатается.
 */
export function printSourceFromPageData(
  bundle: DayDocBundle,
  sheet: CallSheetBlocks | null,
  elements: ElementsEditorData | null,
  astro: DayAstro | null,
  workingDay: CallSheetPrintSource["workingDay"],
): CallSheetPrintSource {
  return {
    project: bundle.project,
    day: bundle.day,
    actors: bundle.actors,
    workingDay,
    astro,
    sheet,
    elements,
  };
}

/** Объекты сцен дня — без повторов, по порядку сцен. */
export function dayLocationsOf(bundle: DayDocBundle) {
  return [
    ...new Map(
      bundle.day.scenes
        .flatMap((s) => s.scene.locations.map((l) => l.location))
        .map((location) => [location.id, location]),
    ).values(),
  ];
}

// ---- Право чтения (печать, Excel) ----

export const NOT_WORKING_DAY = "Вызывной формируется только для рабочих съёмочных дней";

export type CallSheetReadDeps = {
  /** «КПП и вызывные: просмотр» (`callsheet:read || schedule:read`). */
  canRead: boolean;
  /** День этого проекта: null — нет такого дня в проекте; иначе — рабочий ли он. */
  dayInProject: (dayId: string) => Promise<{ working: boolean } | null>;
};

/**
 * Проверка перед печатью и Excel: право → день этого проекта → рабочий день.
 * Без права до базы не доходит.
 */
export async function checkCallSheetRead(
  deps: CallSheetReadDeps,
  dayId: unknown,
): Promise<{ dayId: string } | { error: string; status: 403 | 404 }> {
  if (!deps.canRead) return { error: NO_RIGHTS, status: 403 };
  if (typeof dayId !== "string" || dayId.trim() === "" || dayId.length > 100) {
    return { error: DAY_NOT_FOUND, status: 404 };
  }
  const day = await deps.dayInProject(dayId);
  if (!day) return { error: DAY_NOT_FOUND, status: 404 };
  if (!day.working) return { error: NOT_WORKING_DAY, status: 404 };
  return { dayId };
}

// ---- Имя файла ----

/** «Вызывной ИРП 11.09.2026 смена 40» — без символов, запрещённых в именах файлов. */
export function callSheetFileBaseName(model: Pick<CallSheetPrintModel, "projectName" | "numericDate" | "shiftNumber">) {
  const name = [
    "Вызывной",
    model.projectName,
    model.numericDate,
    model.shiftNumber ? `смена ${model.shiftNumber}` : null,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name.slice(0, 150) || "Вызывной";
}

/**
 * `Content-Disposition: attachment` для имени с кириллицей: `filename` — запасное ASCII,
 * `filename*` — UTF-8 (RFC 5987/6266).
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// ---- Снимок утверждения и отпечаток данных дня ----

/** JSON с ключами по алфавиту на всех уровнях: тот же отпечаток при любом порядке ключей. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Отпечаток данных дня для плашки «данные дня изменились после утверждения». Модель листа
 * строится без прогноза погоды и солнца (`astro`): их меняет прогноз, а не группа — иначе
 * плашка появлялась бы от каждого обновления прогноза. Руками введённые t днём / ночью,
 * описание погоды дня и всё остальное — в отпечатке.
 */
export function callSheetDataHash(source: CallSheetPrintSource): string {
  const model = buildCallSheetPrintModel({ ...source, astro: null });
  return createHash("sha256").update(stableJson(model)).digest("hex");
}

/** Снимок из базы → модель листа; не та форма — null (печатать нечего). */
export function parseSnapshotModel(snapshot: unknown): CallSheetPrintModel | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const model = snapshot as Partial<CallSheetPrintModel>;
  if (model.modelVersion !== 1 || typeof model.projectName !== "string") return null;
  return model as CallSheetPrintModel;
}

/** Номер версии из адреса (`?version=N`): нет — undefined, не число ≥ 1 — null (отказ). */
export function parseVersionParam(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const text = typeof raw === "number" ? String(raw) : raw;
  if (typeof text !== "string" || !/^[1-9]\d{0,5}$/.test(text)) return null;
  return Number(text);
}

/**
 * Откуда печатать: версия из адреса — её снимок; утверждённый — снимок своей версии
 * (не живые данные, даже если КПП потом поменяли); черновик и «на согласовании» — живые данные.
 */
export function choosePrintSource(
  sheet: { status: string; version: number } | null,
  requested: number | undefined,
): { kind: "snapshot"; version: number } | { kind: "live" } {
  if (requested !== undefined) return { kind: "snapshot", version: requested };
  if (sheet?.status === "APPROVED") return { kind: "snapshot", version: sheet.version };
  return { kind: "live" };
}

// ---- Адрес просмотра ----

/**
 * Адрес листа для просмотра на странице. `v` — отпечаток модели: правки и «Обновить из КПП»
 * меняют модель → меняется адрес → iframe перезагружается; без правок — тот же адрес.
 */
export function callSheetPreviewSrc(
  projectId: string,
  dayId: string,
  model: CallSheetPrintModel,
  /** Статус и версия: утверждение и «Внести изменения» меняют лист без правки данных. */
  state: { status: string; version: number } | null = null,
) {
  const version = createHash("sha256")
    .update(JSON.stringify(state ? [model, state.status, state.version] : model))
    .digest("hex")
    .slice(0, 16);
  return `/api/projects/${encodeURIComponent(projectId)}/call-sheets/${encodeURIComponent(dayId)}/sheet?v=${version}`;
}
