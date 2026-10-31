import type { TimingMode } from "@prisma/client";
import type { BlockTypingResult } from "@/features/import/normalize/block-types";
import type { DictionaryRule } from "@/features/import/normalize/dictionary";
import type { ExistingRecords } from "@/features/import/normalize/normalize-script";

/**
 * Отправляемый на сервер (облегчённый) docx — не больше 3,5 МБ: запрос к серверу у Vercel —
 * до 4,5 МБ. Проверка в браузере и на сервере.
 */
export const SCRIPT_IMPORT_MAX_BYTES = 3.5 * 1024 * 1024;

/** Исходный файл в браузере — до 50 МБ: картинки на сервер не уходят (облегчённый docx). */
export const SCRIPT_SOURCE_MAX_BYTES = 50 * 1024 * 1024;

export function formatMegabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
}

export function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} КБ` : formatMegabytes(bytes);
}

/**
 * Ответ предпросмотра. Сервер разбирает файл один раз и ничего не пишет; вопросы, сводку,
 * «было → стало» и хронометраж браузер считает сам той же функцией `normalizeScript`.
 */
export type ScriptReviewData = {
  fileName: string;
  /** Размер присланного (облегчённого) docx — исходный сервер не видит. */
  fileSize: number;
  /** sha256 облегчённого docx: при «Импортировать» сервер сверит, что разбирает тот же файл. */
  fileHash: string;
  /** Текущая версия сценария на момент предпросмотра: сменилась — импорт отклоняется. */
  currentVersionId: string | null;
  typing: BlockTypingResult;
  /**
   * Синхронизация версии с либретто вместо импорта файла: файла нет, `fileHash` — хэш блоков
   * версии, текст версии и титульная не меняются.
   */
  sync?: {
    versionId: string;
    label: string;
    /** Версия не текущая: после «Обновить либретто» она станет текущей. */
    isCurrent: boolean;
    /** Текущая версия проекта (её место займёт эта). */
    currentLabel: string | null;
  };
  dictionary: DictionaryRule[];
  existing: ExistingRecords;
  timing: { mode: TimingMode; pageToMinuteRatio: number };
};

export type ScriptPreviewState = { error?: string; data?: ScriptReviewData };

/** Ответ «Импортировать»: id новой версии или отказ. */
export type ScriptImportState = { error?: string; success?: string; versionId?: string };
