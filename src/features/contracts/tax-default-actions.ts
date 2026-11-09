"use server";

import { contractFinanceAccess } from "@/features/contracts/lib/finance-access";
import type { CounterpartyTaxDefault } from "@/features/contracts/lib/tax-default";
import { assertInProject, isNotInProjectError } from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

/**
 * Налог по умолчанию для нового договора или акта с этим контрагентом. Только тем, кто правит
 * договоры и их суммы (процент — финансовые данные). Ничего не пишет.
 */
export async function counterpartyTaxDefaultAction(
  projectId: string,
  counterpartyId: string,
): Promise<{ error: string } | { value: CounterpartyTaxDefault }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write") || !contractFinanceAccess(ctx.can).write) {
    return { error: "Недостаточно прав" };
  }
  if (typeof counterpartyId !== "string" || counterpartyId.trim() === "") {
    return { value: { mapped: false } };
  }
  try {
    await assertInProject("Counterparty", counterpartyId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Контрагент не найден" };
    throw error;
  }

  const counterparty = await prisma.counterparty.findFirst({
    where: { id: counterpartyId, projectId },
    select: { type: true },
  });
  if (!counterparty) return { error: "Контрагент не найден" };

  const mapping = await prisma.projectCounterpartyPaymentForm.findUnique({
    where: { projectId_counterpartyType: { projectId, counterpartyType: counterparty.type } },
    select: { paymentForm: { select: { defaultTaxPercent: true, archivedAt: true } } },
  });
  if (!mapping || mapping.paymentForm.archivedAt !== null) return { value: { mapped: false } };
  const percent = mapping.paymentForm.defaultTaxPercent;
  return { value: { mapped: true, rate: percent == null ? null : Number(percent) } };
}
