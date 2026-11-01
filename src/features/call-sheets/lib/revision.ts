/**
 * Номер правки вызывного (`CallSheet.revision`). Каждое сохранение вызывного и данных дня из
 * вызывного присылает номер, с которым работал браузер. Под блокировкой строки `CallSheet`
 * (`SELECT … FOR UPDATE`) номер сверяется: не совпал — отказ, совпал — +1 в той же транзакции,
 * что и запись. Утверждённый вызывной не правится до «Внести изменения».
 *
 * Чистые функции: база — через `RevisionDb`, тесты — без базы. Действия вызывают
 * `withCallSheetRevision` (`call-sheets/revision-db.ts`), который подставляет транзакцию.
 */

export const REVISION_CONFLICT = "Вызывной изменили в другом окне — обновите страницу";
export const CALL_SHEET_APPROVED = "Вызывной утверждён — нажмите «Внести изменения»";

/** Имя поля формы с номером правки. */
export const REVISION_FIELD = "revision";

export type CallSheetStatusValue = "DRAFT" | "IN_REVIEW" | "APPROVED";

/** Строка вызывного под блокировкой. */
export type LockedCallSheet = {
  id: string;
  status: CallSheetStatusValue;
  version: number;
  revision: number;
};

/**
 * Номер правки, с которым работал браузер: число — вызывной был; null — вызывного ещё не было
 * (пустая строка, поле не прислано); undefined — прислан мусор (отказ как «изменили»).
 */
export type ExpectedRevision = number | null | undefined;

export function parseExpectedRevision(raw: unknown): ExpectedRevision {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined;
  }
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw)) return undefined;
  return Number(raw);
}

/** Почему сохранение нельзя: null — можно. Утверждённый — раньше, чем «изменили». */
export function revisionError(
  sheet: Pick<LockedCallSheet, "status" | "revision"> | null,
  expected: ExpectedRevision,
): string | null {
  if (expected === undefined) return REVISION_CONFLICT;
  if (!sheet) return expected === null ? null : REVISION_CONFLICT;
  if (sheet.status === "APPROVED") return CALL_SHEET_APPROVED;
  return expected === sheet.revision ? null : REVISION_CONFLICT;
}

/** Отказ внутри транзакции: она откатывается, действие отвечает текстом. */
export class CallSheetEditRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallSheetEditRefused";
  }
}

export function isCallSheetEditRefused(error: unknown): error is CallSheetEditRefused {
  return error instanceof CallSheetEditRefused;
}

/** Что нужно от транзакции: заблокировать строку вызывного и записать номер правки. */
export type RevisionDb = {
  lockCallSheet: (shootDayId: string) => Promise<LockedCallSheet | null>;
  setRevision: (callSheetId: string, revision: number) => Promise<void>;
};

/**
 * Сверка и +1 под блокировкой. Вызывного нет и браузер его не видел — номера нет (null),
 * запись идёт как раньше (данные дня до «Создать вызывной»).
 */
export async function bumpCallSheetRevision(
  db: RevisionDb,
  shootDayId: string,
  expected: ExpectedRevision,
): Promise<number | null> {
  const sheet = await db.lockCallSheet(shootDayId);
  const error = revisionError(sheet, expected);
  if (error) throw new CallSheetEditRefused(error);
  if (!sheet) return null;
  const next = sheet.revision + 1;
  await db.setRevision(sheet.id, next);
  return next;
}

/**
 * Запись с номером правки: в одной транзакции — сверка и +1, потом `write`. Отказ — до
 * первой записи (`write` не вызывается), транзакция откатывается.
 */
export async function runWithRevision<TTx, T>(
  transaction: <R>(fn: (tx: TTx) => Promise<R>) => Promise<R>,
  revisionDb: (tx: TTx) => RevisionDb,
  shootDayId: string,
  expected: ExpectedRevision,
  write: (tx: TTx) => Promise<T>,
): Promise<{ result: T; revision: number | null }> {
  return transaction(async (tx) => {
    const revision = await bumpCallSheetRevision(revisionDb(tx), shootDayId, expected);
    const result = await write(tx);
    return { result, revision };
  });
}
