/**
 * «Ждут утверждения»: вызывные на согласовании — счётчик у пункта «Вызывные» в меню проекта
 * и строка с фильтром в списке вызывных. Только для участника с правом «Вызывные — утверждение».
 */

import type { Permission } from "@/features/memberships/permissions";
import type { CallSheetStatusValue } from "@/features/call-sheets/lib/revision";

export const CALL_SHEET_APPROVE_PERMISSION: Permission = "callsheet:approve";

/** Значение `?filter=` списка вызывных: только ждущие утверждения. */
export const AWAITING_APPROVAL_FILTER = "review";

/**
 * Счётчик для меню. Без права — `null`, и запрос в базу не выполняется. Сам запрос — `count`
 * (`countCallSheetsAwaitingApproval`), вызывные не загружаются.
 */
export async function awaitingApprovalCount(
  can: (permission: Permission) => boolean,
  count: () => Promise<number>,
): Promise<number | null> {
  if (!can(CALL_SHEET_APPROVE_PERMISSION)) return null;
  return count();
}

export function isAwaitingApproval(
  callSheet: { status: CallSheetStatusValue } | null | undefined,
): boolean {
  return callSheet?.status === "IN_REVIEW";
}
