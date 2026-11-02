import type { CloudProvider } from "@prisma/client";
import type { CallSheetStatusValue } from "@/features/call-sheets/lib/revision";
import type { CallSheetStamp } from "@/features/call-sheets/print/stamp";

/**
 * Выгрузка вызывного на диск — чистые правила: имя файла, папки, выбор версии,
 * разбор того, что пришло из браузера. Без базы и сети; годится и для браузера (окно выгрузки).
 */

/** Статус в имени файла и в строке «уже на диске»: строчными. */
export const DRIVE_STATUS_LABELS: Record<CallSheetStatusValue, string> = {
  DRAFT: "черновик",
  IN_REVIEW: "на согласовании",
  APPROVED: "утверждён",
};

/** Ключи папок системы на диске (`DriveFolder.key`). */
export const DRIVE_FOLDER_KEYS = { root: "root", callSheets: "callsheets" } as const;

export const CALL_SHEETS_FOLDER_NAME = "Вызывные";

/** Верхняя папка проекта на Google Диске: `PELENA · <Проект>`. */
export function googleProjectFolderName(projectName: string) {
  return `PELENA · ${projectName.trim() || "Проект"}`;
}

/**
 * Папка проекта на Яндекс Диске: `<Проект> · <6 последних символов id>`. Папки на Яндексе —
 * по пути, а не по id: без хвоста два проекта с одним названием попали бы в одну папку и
 * перезаписывали бы файлы друг друга.
 */
export function yandexProjectFolderName(projectName: string, projectId: string) {
  return `${projectName.trim() || "Проект"} · ${projectId.slice(-6)}`;
}

/** «11.09.2026» — дата дня по часовому поясу проекта (дни хранятся полночью по поясу проекта). */
export function formatDriveDate(date: Date | string, timezone: string | null): string {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone || "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(date));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")}`;
}

/**
 * Имя файла на диске: «Вызывной · день 12 · 11.09.2026 · версия 2 (черновик)». Вызывной ещё не
 * создан (версии нет) — «Вызывной · день 12 · 11.09.2026 (черновик)». Без расширения: у Google
 * Таблицы его нет, Яндексу `.xlsx` добавляет вызывающий.
 */
export function callSheetDriveFileName(
  day: { dayNumber: number; date: Date | string },
  timezone: string | null,
  stamp: Pick<CallSheetStamp, "status" | "version">,
): string {
  const label = DRIVE_STATUS_LABELS[stamp.status];
  const head = `Вызывной · день ${day.dayNumber} · ${formatDriveDate(day.date, timezone)}`;
  return stamp.version ? `${head} · версия ${stamp.version} (${label})` : `${head} (${label})`;
}

/**
 * Версия в окне выгрузки по умолчанию: утверждён — его версия (снимок); черновик и
 * «на согласовании» — `null`, текущее состояние с меткой на листе.
 */
export function defaultDriveExportVersion(
  sheet: { status: CallSheetStatusValue; version: number } | null,
): number | null {
  return sheet?.status === "APPROVED" ? sheet.version : null;
}

export const DRIVE_EXPORT_BAD_INPUT = "Выберите диск и версию";

const PROVIDERS: readonly CloudProvider[] = ["GOOGLE_DRIVE", "YANDEX_DISK"];

/**
 * Что пришло из браузера: только провайдер и номер утверждённой версии (пусто — текущая).
 * Почты, id папок и файлов из браузера не принимаются.
 */
export function parseDriveExportInput(
  raw: unknown,
): { provider: CloudProvider; version: number | undefined } | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: DRIVE_EXPORT_BAD_INPUT };
  const { provider, version } = raw as { provider?: unknown; version?: unknown };
  if (typeof provider !== "string" || !PROVIDERS.includes(provider as CloudProvider)) {
    return { error: DRIVE_EXPORT_BAD_INPUT };
  }
  // Как `?version=N` у печати и Excel: пусто — текущая, иначе целое ≥ 1.
  if (version === undefined || version === null) return { provider: provider as CloudProvider, version: undefined };
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 999_999) {
    return { error: DRIVE_EXPORT_BAD_INPUT };
  }
  return { provider: provider as CloudProvider, version };
}

export type DrivePutOutcome = "created" | "replaced" | "recreated";

/** Сообщение после выгрузки. `recreated` — прежний файл или папку удалили на диске руками. */
export function driveExportDoneText(provider: CloudProvider, outcome: DrivePutOutcome): string {
  const google = provider === "GOOGLE_DRIVE";
  if (outcome === "replaced") {
    return google
      ? "Файл на Google Диске обновлён — ссылка прежняя"
      : "Файл на Яндекс Диске обновлён";
  }
  if (outcome === "recreated") {
    return google
      ? "Прежний файл или папку на Google Диске удалили — создан новый файл, ссылка новая"
      : "Прежний файл на Яндекс Диске не найден — создан заново";
  }
  return google ? "Вызывной выгружен на Google Диск" : "Вызывной выгружен на Яндекс Диск";
}

export const YANDEX_PERSONAL_NOTE =
  "На Яндекс Диске система не может выдать доступ людям — файл увидите только вы";
