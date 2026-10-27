"use server";

import { ContractFileRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { contractFinanceAccess } from "@/features/contracts/lib/finance-access";
import {
  computeContractVat,
  parseTags,
} from "@/features/contracts/lib/vat";
import { certificateFormSchema, contractFormSchema } from "@/features/contracts/schemas";
import { ensureApprovalStatuses } from "@/features/finance/queries-approval-statuses";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type ContractsActionState = {
  error?: string;
  success?: string;
  contractId?: string;
  actId?: string;
  certificateId?: string;
};

function revalidateContracts(projectId: string, contractId?: string) {
  revalidatePath(`/ru/projects/${projectId}/counterparties`);
  revalidatePath(`/ru/projects/${projectId}/counterparties/contracts`);
  revalidatePath(`/ru/projects/${projectId}/counterparties/acts`);
  if (contractId) {
    revalidatePath(
      `/ru/projects/${projectId}/counterparties/contracts/${contractId}`,
    );
  }
}

function parseDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formBool(formData: FormData, key: string) {
  const v = formData.get(key);
  return v === "on" || v === "true" || v === "1";
}

function parseContractForm(formData: FormData) {
  const tagsRaw = String(formData.get("tags") ?? "");
  return contractFormSchema.safeParse({
    date: formData.get("date"),
    number: formData.get("number"),
    companyId: formData.get("companyId"),
    counterpartyId: formData.get("counterpartyId"),
    ledgerTypeId: formData.get("ledgerTypeId") || undefined,
    amount: formData.get("amount"),
    vatEnabled: formBool(formData, "vatEnabled"),
    vatRate: formData.get("vatRate") || null,
    vatAmountManual: formData.get("vatAmountManual") || null,
    isPreliminary: formBool(formData, "isPreliminary"),
    statusId: formData.get("statusId"),
    tags: parseTags(tagsRaw),
    summary: formData.get("summary") || null,
    comment: formData.get("comment") || null,
    creditsName: formData.get("creditsName") || null,
  });
}

type AmountInput = {
  amount: number;
  vatEnabled: boolean;
  vatRate?: number | null;
  vatAmountManual?: number | null;
};

/** Поля сумм договора или акта для записи в базу. */
function amountFields(input: AmountInput) {
  const vat = computeContractVat({
    amount: input.amount,
    vatEnabled: input.vatEnabled,
    vatRate: input.vatRate,
    vatAmountManual: input.vatAmountManual,
  });
  return {
    amount: input.amount,
    vatEnabled: input.vatEnabled,
    vatRate: input.vatEnabled ? (input.vatRate ?? 22) : null,
    vatAmount: vat.vatAmount,
    amountWithVat: vat.amountWithVat,
  };
}

function contractAmounts(input: AmountInput & { isPreliminary: boolean }) {
  return { ...amountFields(input), isPreliminary: input.isPreliminary };
}

async function defaultUnsignedStatusId(projectId: string) {
  await ensureApprovalStatuses(projectId);
  const unsigned = await prisma.projectApprovalStatus.findFirst({
    where: { projectId, key: "UNSIGNED" },
    select: { id: true },
  });
  if (unsigned) return unsigned.id;
  const any = await prisma.projectApprovalStatus.findFirst({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  return any?.id ?? null;
}

export async function createContractAction(
  projectId: string,
  _prev: ContractsActionState,
  formData: FormData,
): Promise<ContractsActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };
  const finance = contractFinanceAccess(ctx.can);

  const parsed = parseContractForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }
  const date = parseDate(parsed.data.date);
  if (!date) return { error: "Некорректная дата" };

  try {
    await assertInProject("Company", parsed.data.companyId, projectId);
    await assertInProject("Counterparty", parsed.data.counterpartyId, projectId);
    await assertInProject(
      "ProjectApprovalStatus",
      parsed.data.statusId,
      projectId,
    );
    if (parsed.data.ledgerTypeId) {
      await assertInProject(
        "ProjectLedgerType",
        parsed.data.ledgerTypeId,
        projectId,
      );
    }
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Объект не найден" };
    throw error;
  }

  // Без права на финансы суммы из формы не принимаются: договор создаётся с нулевой
  // суммой и ставкой НДС по умолчанию, суммы потом заполнит тот, у кого есть право.
  const amounts = finance.write
    ? contractAmounts(parsed.data)
    : contractAmounts({
        amount: 0,
        vatEnabled: true,
        vatRate: null,
        vatAmountManual: null,
        isPreliminary: false,
      });

  const row = await prisma.contract.create({
    data: {
      projectId,
      date,
      number: parsed.data.number,
      companyId: parsed.data.companyId,
      counterpartyId: parsed.data.counterpartyId,
      ledgerTypeId: parsed.data.ledgerTypeId ?? null,
      ...amounts,
      statusId: parsed.data.statusId,
      tags: parsed.data.tags,
      summary: parsed.data.summary,
      comment: parsed.data.comment,
      creditsName: parsed.data.creditsName,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.contract,
    entityId: row.id,
    action: "CREATE",
    summary: `Создан договор ${row.number}`,
  });

  revalidateContracts(projectId, row.id);
  return { success: "Договор создан", contractId: row.id };
}

export async function updateContractAction(
  projectId: string,
  contractId: string,
  _prev: ContractsActionState,
  formData: FormData,
): Promise<ContractsActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };
  const finance = contractFinanceAccess(ctx.can);

  const existing = await prisma.contract.findFirst({
    where: { id: contractId, projectId },
    select: { id: true },
  });
  if (!existing) return { error: "Договор не найден" };

  const parsed = parseContractForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }
  const date = parseDate(parsed.data.date);
  if (!date) return { error: "Некорректная дата" };

  try {
    await assertInProject("Company", parsed.data.companyId, projectId);
    await assertInProject("Counterparty", parsed.data.counterpartyId, projectId);
    await assertInProject(
      "ProjectApprovalStatus",
      parsed.data.statusId,
      projectId,
    );
    if (parsed.data.ledgerTypeId) {
      await assertInProject(
        "ProjectLedgerType",
        parsed.data.ledgerTypeId,
        projectId,
      );
    }
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Объект не найден" };
    throw error;
  }

  await prisma.contract.update({
    where: { id: contractId },
    data: {
      date,
      number: parsed.data.number,
      companyId: parsed.data.companyId,
      counterpartyId: parsed.data.counterpartyId,
      ledgerTypeId: parsed.data.ledgerTypeId ?? null,
      // Без права на финансы суммы остаются прежними.
      ...(finance.write ? contractAmounts(parsed.data) : {}),
      statusId: parsed.data.statusId,
      tags: parsed.data.tags,
      summary: parsed.data.summary,
      comment: parsed.data.comment,
      creditsName: parsed.data.creditsName,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.contract,
    entityId: contractId,
    action: "UPDATE",
    summary: `Обновлён договор ${parsed.data.number}`,
  });

  revalidateContracts(projectId, contractId);
  return { success: "Договор сохранён", contractId };
}

export async function deleteContractAction(
  projectId: string,
  contractId: string,
): Promise<ContractsActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.contract.findFirst({
    where: { id: contractId, projectId },
    select: { id: true, number: true },
  });
  if (!existing) return { error: "Договор не найден" };

  await prisma.contract.delete({ where: { id: contractId } });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.contract,
    entityId: contractId,
    action: "DELETE",
    summary: `Удалён договор ${existing.number}`,
  });

  revalidateContracts(projectId);
  return { success: "Договор удалён" };
}

export async function createLedgerTypeAction(
  projectId: string,
  name: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Укажите название" };

  // Тип с таким же названием (без учёта регистра) уже есть — выбираем его, а не плодим дубль.
  const findExisting = () =>
    prisma.projectLedgerType.findFirst({
      where: { projectId, name: { equals: trimmed, mode: "insensitive" } },
      select: { id: true, name: true },
    });

  const existing = await findExisting();
  if (existing) return existing;

  let row: { id: string; name: string };
  try {
    const max = await prisma.projectLedgerType.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    });
    row = await prisma.projectLedgerType.create({
      data: {
        projectId,
        name: trimmed,
        isSystem: false,
        sortOrder: (max._max.sortOrder ?? 100) + 10,
      },
      select: { id: true, name: true },
    });
  } catch {
    // Тот же тип только что создал кто-то другой.
    const raced = await findExisting();
    if (raced) return raced;
    return { error: "Не удалось добавить тип" };
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.ledgerType,
    entityId: row.id,
    action: "CREATE",
    summary: `Добавлен тип ведомости ${row.name}`,
  });
  revalidateContracts(projectId);
  return row;
}

export async function quickCreateApprovalStatusAction(
  projectId: string,
  name: string,
  color = "#64748b",
): Promise<{ id: string; name: string; color: string } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Укажите название" };

  const { normalizeApprovalColor } = await import(
    "@/features/finance/lib/approval-statuses"
  );
  const hex = normalizeApprovalColor(color) ?? "#64748b";

  try {
    const max = await prisma.projectApprovalStatus.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    });
    const row = await prisma.projectApprovalStatus.create({
      data: {
        projectId,
        name: trimmed,
        color: hex,
        isSystem: false,
        sortOrder: (max._max.sortOrder ?? 100) + 10,
      },
    });
    revalidatePath(`/ru/projects/${projectId}/finance/settings`);
    revalidateContracts(projectId);
    return { id: row.id, name: row.name, color: row.color };
  } catch {
    return { error: "Статус с таким названием уже есть" };
  }
}

export async function attachContractFileAction(
  projectId: string,
  contractId: string,
  fileId: string,
  role: ContractFileRole = "OTHER",
): Promise<ContractsActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };

  const contract = await prisma.contract.findFirst({
    where: { id: contractId, projectId },
    select: { id: true },
  });
  if (!contract) return { error: "Договор не найден" };

  const file = await prisma.projectFile.findFirst({
    where: { id: fileId, projectId },
    select: { id: true },
  });
  if (!file) return { error: "Файл не найден" };

  await prisma.contractFile.upsert({
    where: { contractId_fileId: { contractId, fileId } },
    create: { contractId, fileId, role },
    update: { role },
  });

  revalidateContracts(projectId, contractId);
  return { success: "Файл прикреплён" };
}

export async function detachContractFileAction(
  projectId: string,
  contractId: string,
  linkId: string,
): Promise<ContractsActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };

  await prisma.contractFile.deleteMany({
    where: { id: linkId, contract: { projectId, id: contractId } },
  });
  revalidateContracts(projectId, contractId);
  return { success: "Файл откреплён" };
}

export async function updateContractFileRoleAction(
  projectId: string,
  contractId: string,
  linkId: string,
  role: ContractFileRole,
): Promise<ContractsActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };

  await prisma.contractFile.updateMany({
    where: { id: linkId, contractId, contract: { projectId } },
    data: { role },
  });
  revalidateContracts(projectId, contractId);
  return { success: "Тип файла обновлён" };
}

function parseCertificateForm(formData: FormData) {
  return certificateFormSchema.safeParse({
    date: formData.get("date"),
    number: formData.get("number"),
    companyId: formData.get("companyId"),
    counterpartyId: formData.get("counterpartyId"),
    contractId: formData.get("contractId") || undefined,
    paymentId: formData.get("paymentId") || undefined,
    amount: formData.get("amount"),
    vatEnabled: formBool(formData, "vatEnabled"),
    vatRate: formData.get("vatRate") || null,
    vatAmountManual: formData.get("vatAmountManual") || null,
    statusId: formData.get("statusId"),
    summary: formData.get("summary") || null,
    comment: formData.get("comment") || null,
  });
}

function revalidateCertificates(
  projectId: string,
  opts?: { contractId?: string | null; paymentId?: string | null; certificateId?: string },
) {
  revalidateContracts(projectId, opts?.contractId ?? undefined);
  revalidatePath(`/ru/projects/${projectId}/counterparties/acts`);
  revalidatePath(`/ru/projects/${projectId}/payments`);
  if (opts?.paymentId) {
    revalidatePath(`/ru/projects/${projectId}/payments/${opts.paymentId}`);
  }
  if (opts?.certificateId) {
    revalidatePath(
      `/ru/projects/${projectId}/counterparties/acts/${opts.certificateId}`,
    );
  }
}

export async function createCertificateAction(
  projectId: string,
  _prev: ContractsActionState,
  formData: FormData,
): Promise<ContractsActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };
  const finance = contractFinanceAccess(ctx.can);

  const parsed = parseCertificateForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }
  const date = parseDate(parsed.data.date);
  if (!date) return { error: "Некорректная дата" };

  let statusId = parsed.data.statusId;
  // Платёж — данные «Финансов»: без права на них привязка из формы не принимается.
  const paymentId = finance.write ? (parsed.data.paymentId ?? null) : null;
  let contractId = parsed.data.contractId ?? null;
  let companyId = parsed.data.companyId;
  let counterpartyId = parsed.data.counterpartyId;

  if (paymentId) {
    const payment = await prisma.cashPayment.findFirst({
      where: { id: paymentId, projectId },
      select: {
        id: true,
        companyId: true,
        counterpartyId: true,
        contractId: true,
      },
    });
    if (!payment) return { error: "Платёж не найден" };
    companyId = payment.companyId;
    counterpartyId = payment.counterpartyId;
    if (payment.contractId) contractId = payment.contractId;
  }

  try {
    await assertInProject("Company", companyId, projectId);
    await assertInProject("Counterparty", counterpartyId, projectId);
    if (statusId) {
      await assertInProject("ProjectApprovalStatus", statusId, projectId);
    }
    if (contractId) await assertInProject("Contract", contractId, projectId);
    if (paymentId) await assertInProject("CashPayment", paymentId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Объект не найден" };
    throw error;
  }

  if (!statusId) {
    const fallback = await defaultUnsignedStatusId(projectId);
    if (!fallback) return { error: "Нет статусов согласования" };
    statusId = fallback;
  }

  // Без права на финансы акт создаётся с нулевой суммой, без НДС (как в пустой форме акта).
  const amounts = amountFields(
    finance.write
      ? parsed.data
      : { amount: 0, vatEnabled: false, vatRate: null, vatAmountManual: null },
  );

  const row = await prisma.certificate.create({
    data: {
      projectId,
      date,
      number: parsed.data.number,
      companyId,
      counterpartyId,
      contractId,
      paymentId,
      ...amounts,
      statusId,
      summary: parsed.data.summary,
      comment: parsed.data.comment,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.certificate,
    entityId: row.id,
    action: "CREATE",
    summary: `Создан акт ${row.number}`,
  });

  revalidateCertificates(projectId, {
    contractId,
    paymentId,
    certificateId: row.id,
  });
  return {
    success: "Акт создан",
    actId: row.id,
    certificateId: row.id,
  };
}

/** @deprecated alias */
export const createActAction = createCertificateAction;

export async function updateCertificateAction(
  projectId: string,
  certificateId: string,
  _prev: ContractsActionState,
  formData: FormData,
): Promise<ContractsActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };
  const finance = contractFinanceAccess(ctx.can);

  const existing = await prisma.certificate.findFirst({
    where: { id: certificateId, projectId },
    select: { id: true, contractId: true, paymentId: true },
  });
  if (!existing) return { error: "Акт не найден" };

  const parsed = parseCertificateForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }
  const date = parseDate(parsed.data.date);
  if (!date) return { error: "Некорректная дата" };

  // Без права на финансы суммы и привязка к платежу остаются прежними.
  const paymentId = finance.write
    ? (parsed.data.paymentId ?? null)
    : existing.paymentId;

  try {
    await assertInProject("Company", parsed.data.companyId, projectId);
    await assertInProject(
      "Counterparty",
      parsed.data.counterpartyId,
      projectId,
    );
    await assertInProject(
      "ProjectApprovalStatus",
      parsed.data.statusId,
      projectId,
    );
    if (parsed.data.contractId) {
      await assertInProject("Contract", parsed.data.contractId, projectId);
    }
    if (finance.write && paymentId) {
      await assertInProject("CashPayment", paymentId, projectId);
    }
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Объект не найден" };
    throw error;
  }

  await prisma.certificate.update({
    where: { id: certificateId },
    data: {
      date,
      number: parsed.data.number,
      companyId: parsed.data.companyId,
      counterpartyId: parsed.data.counterpartyId,
      contractId: parsed.data.contractId ?? null,
      paymentId,
      ...(finance.write ? amountFields(parsed.data) : {}),
      statusId: parsed.data.statusId,
      summary: parsed.data.summary,
      comment: parsed.data.comment,
    },
  });

  // Как у договоров: только номер, без сумм и данных контрагента.
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.certificate,
    entityId: certificateId,
    action: "UPDATE",
    summary: `Обновлён акт ${parsed.data.number}`,
  });

  revalidateCertificates(projectId, {
    contractId: parsed.data.contractId ?? existing.contractId,
    paymentId: paymentId ?? existing.paymentId,
    certificateId,
  });
  return { success: "Акт сохранён", certificateId, actId: certificateId };
}

export const updateActAction = updateCertificateAction;

export async function deleteCertificateAction(
  projectId: string,
  certificateId: string,
): Promise<ContractsActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.certificate.findFirst({
    where: { id: certificateId, projectId },
    select: { id: true, number: true, contractId: true, paymentId: true },
  });
  if (!existing) return { error: "Акт не найден" };

  await prisma.certificate.delete({ where: { id: certificateId } });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.certificate,
    entityId: certificateId,
    action: "DELETE",
    summary: `Удалён акт ${existing.number}`,
  });

  revalidateCertificates(projectId, {
    contractId: existing.contractId,
    paymentId: existing.paymentId,
  });
  return { success: "Акт удалён" };
}

export const deleteActAction = deleteCertificateAction;

export async function attachCertificateFileAction(
  projectId: string,
  certificateId: string,
  fileId: string,
  role: ContractFileRole = "OTHER",
): Promise<ContractsActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };

  const cert = await prisma.certificate.findFirst({
    where: { id: certificateId, projectId },
    select: { id: true, contractId: true, paymentId: true },
  });
  if (!cert) return { error: "Акт не найден" };

  const file = await prisma.projectFile.findFirst({
    where: { id: fileId, projectId },
    select: { id: true },
  });
  if (!file) return { error: "Файл не найден" };

  await prisma.certificateFile.upsert({
    where: {
      certificateId_fileId: { certificateId, fileId },
    },
    create: { certificateId, fileId, role },
    update: { role },
  });

  revalidateCertificates(projectId, {
    certificateId,
    contractId: cert.contractId,
    paymentId: cert.paymentId,
  });
  return { success: "Файл прикреплён" };
}

export async function detachCertificateFileAction(
  projectId: string,
  certificateId: string,
  linkId: string,
): Promise<ContractsActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("contracts:write")) return { error: "Недостаточно прав" };

  const link = await prisma.certificateFile.findFirst({
    where: {
      id: linkId,
      certificate: { id: certificateId, projectId },
    },
    include: {
      certificate: { select: { contractId: true, paymentId: true } },
    },
  });
  if (!link) return { error: "Файл не найден" };

  await prisma.certificateFile.delete({ where: { id: linkId } });
  revalidateCertificates(projectId, {
    certificateId,
    contractId: link.certificate.contractId,
    paymentId: link.certificate.paymentId,
  });
  return { success: "Файл откреплён" };
}
