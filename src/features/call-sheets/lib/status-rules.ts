/**
 * Статусы вызывного: черновик → «На согласование» → «Утвердить» или «Вернуть в черновик»;
 * утверждённый → «Внести изменения» → черновик следующей версии. Чистые функции: действия
 * (`call-sheets/status-actions.ts`) вызывают именно их под блокировкой строки вызывного.
 */

import {
  CallSheetEditRefused,
  REVISION_CONFLICT,
  type CallSheetStatusValue,
  type ExpectedRevision,
  type LockedCallSheet,
} from "@/features/call-sheets/lib/revision";
import { NO_RIGHTS } from "@/features/call-sheets/lib/template-rules";
import { CALL_SHEET_STATUS_LABELS } from "@/features/call-sheets/print/stamp";

export type StatusCommand = "submit" | "return" | "approve" | "reopen";

export const SHEET_NOT_CREATED = "Вызывной этого дня ещё не создан";

/** Права для переходов: правка вызывного и «Вызывные — утверждение». */
export type StatusRights = { canEdit: boolean; canApprove: boolean };

const RULES: Record<
  StatusCommand,
  {
    from: CallSheetStatusValue;
    to: CallSheetStatusValue;
    allowed: (rights: StatusRights) => boolean;
    /** «Внести изменения» — следующая версия. */
    nextVersion: boolean;
  }
> = {
  submit: { from: "DRAFT", to: "IN_REVIEW", allowed: (r) => r.canEdit, nextVersion: false },
  // Вернуть может и тот, кто правит (передумал), и тот, кто утверждает (не согласен).
  return: {
    from: "IN_REVIEW",
    to: "DRAFT",
    allowed: (r) => r.canEdit || r.canApprove,
    nextVersion: false,
  },
  approve: { from: "IN_REVIEW", to: "APPROVED", allowed: (r) => r.canApprove, nextVersion: false },
  reopen: { from: "APPROVED", to: "DRAFT", allowed: (r) => r.canEdit, nextVersion: true },
};

/** Хватает ли прав — до обращения к базе. */
export function canRunStatusCommand(command: StatusCommand, rights: StatusRights): boolean {
  return RULES[command].allowed(rights);
}

export type StatusTransition = {
  from: { status: CallSheetStatusValue; version: number };
  to: { status: CallSheetStatusValue; version: number };
  /** Номер правки после перехода: переход тоже правка (другое окно увидит «изменили»). */
  revision: number;
};

/**
 * Переход под блокировкой: права → вызывной есть → номер правки совпал → статус подходит.
 * Номер правки сверяется и у утверждённого: «Внести изменения» из устаревшего окна — отказ.
 */
export function planStatusTransition(
  command: StatusCommand,
  rights: StatusRights,
  sheet: LockedCallSheet | null,
  expected: ExpectedRevision,
): { error: string } | StatusTransition {
  const rule = RULES[command];
  if (!rule.allowed(rights)) return { error: NO_RIGHTS };
  if (!sheet) return { error: SHEET_NOT_CREATED };
  if (expected === undefined || expected === null || expected !== sheet.revision) {
    return { error: REVISION_CONFLICT };
  }
  if (sheet.status !== rule.from) {
    return {
      error: `Вызывной сейчас «${CALL_SHEET_STATUS_LABELS[sheet.status]}» — обновите страницу`,
    };
  }
  return {
    from: { status: sheet.status, version: sheet.version },
    to: { status: rule.to, version: rule.nextVersion ? sheet.version + 1 : sheet.version },
    revision: sheet.revision + 1,
  };
}

/** Что нужно от транзакции перехода. */
export type StatusDb = {
  /** `SELECT … FOR UPDATE` строки вызывного дня. */
  lockCallSheet: (shootDayId: string) => Promise<LockedCallSheet | null>;
  /** Снимок утверждённой версии (только при утверждении). */
  createApprovedVersion: (callSheetId: string, version: number, approvedAt: Date) => Promise<void>;
  updateCallSheet: (
    callSheetId: string,
    data: {
      status: CallSheetStatusValue;
      version: number;
      revision: number;
      /** set — утверждён сейчас; clear — «Внести изменения»; keep — не трогать. */
      approval: { kind: "set"; at: Date } | { kind: "clear" } | { kind: "keep" };
    },
  ) => Promise<void>;
};

/**
 * Тело транзакции перехода: блокировка → проверка → (снимок) → статус. Отказ — исключение
 * `CallSheetEditRefused`, до первой записи. Два окна с одним номером правки: второе ждёт
 * блокировку и видит уже новый номер — отказ «изменили в другом окне».
 */
export async function applyStatusCommand(
  db: StatusDb,
  shootDayId: string,
  command: StatusCommand,
  rights: StatusRights,
  expected: ExpectedRevision,
  now: Date,
): Promise<StatusTransition & { callSheetId: string }> {
  const sheet = await db.lockCallSheet(shootDayId);
  const plan = planStatusTransition(command, rights, sheet, expected);
  if ("error" in plan) throw new CallSheetEditRefused(plan.error);
  const callSheetId = sheet!.id;
  if (command === "approve") {
    await db.createApprovedVersion(callSheetId, plan.to.version, now);
  }
  await db.updateCallSheet(callSheetId, {
    status: plan.to.status,
    version: plan.to.version,
    revision: plan.revision,
    approval:
      command === "approve"
        ? { kind: "set", at: now }
        : command === "reopen"
          ? { kind: "clear" }
          : { kind: "keep" },
  });
  return { ...plan, callSheetId };
}

export const STATUS_COMMAND_SUMMARY: Record<StatusCommand, string> = {
  submit: "отправлен на согласование",
  return: "возвращён в черновик",
  approve: "утверждён",
  reopen: "открыт для изменений",
};
