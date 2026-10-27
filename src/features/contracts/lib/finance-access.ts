import type { Permission } from "@/features/memberships/permissions";

/**
 * Финансовая часть договоров и актов (суммы, НДС, платежи и начисления) —
 * по правам раздела «Финансы», а не «Договоры и акты»:
 * - read: видеть суммы, связанные платежи и начисления;
 * - write: менять суммы и привязку акта к платежу (нужны и просмотр, и изменение «Финансов»).
 */
export type ContractFinanceAccess = { read: boolean; write: boolean };

export function contractFinanceAccess(
  can: (permission: Permission) => boolean,
): ContractFinanceAccess {
  const read = can("finance:read");
  return { read, write: read && can("finance:write") };
}

type AmountFields = {
  amount: unknown;
  vatEnabled: boolean;
  vatRate: unknown;
  vatAmount: unknown;
  amountWithVat: unknown;
};

/**
 * Обнуляет суммы, чтобы они не уходили в браузер без права на финансы.
 * Экран без этого права суммы не показывает — нули нигде не видны.
 */
export function withoutAmounts<T extends AmountFields>(row: T): T {
  return {
    ...row,
    amount: 0,
    vatEnabled: false,
    vatRate: null,
    vatAmount: null,
    amountWithVat: 0,
    ...("isPreliminary" in row ? { isPreliminary: false } : {}),
  } as unknown as T;
}

/** Акт без сумм и без привязки к платежу. */
export function certificateWithoutFinance<
  T extends AmountFields & { paymentId: string | null; payment?: unknown },
>(row: T): T {
  return {
    ...withoutAmounts(row),
    paymentId: null,
    ...("payment" in row ? { payment: null } : {}),
  } as T;
}
