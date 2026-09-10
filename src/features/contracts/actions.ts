"use server";

import { ContractFileRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  computeContractVat,
  parseTags,
} from "@/features/contracts/lib/vat";
import { certificateFormSchema, contractFormSchema } from "@/features/contracts/schemas";
import { ensureApprovalStatuses } from "@/features/finance/queries-approval-statuses";
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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = parseContractForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }
  const date = parseDate(parsed.data.date);
  if (!date) return { error: "Некорректная дата" };

  const vat = computeContractVat({
    amount: parsed.data.amount,
    vatEnabled: parsed.data.vatEnabled,
    vatRate: parsed.data.vatRate,
    vatAmountManual: parsed.data.vatAmountManual,
  });

  const row = await prisma.contract.create({
    data: {
      projectId,
      date,
      number: parsed.data.number,
      companyId: parsed.data.companyId,
      counterpartyId: parsed.data.counterpartyId,
      ledgerTypeId: parsed.data.ledgerTypeId ?? null,
      amount: parsed.data.amount,
      vatEnabled: parsed.data.vatEnabled,
      vatRate: parsed.data.vatEnabled ? (parsed.data.vatRate ?? 22) : null,
      vatAmount: vat.vatAmount,
      amountWithVat: vat.amountWithVat,
      isPreliminary: parsed.data.isPreliminary,
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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

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

  const vat = computeContractVat({
    amount: parsed.data.amount,
    vatEnabled: parsed.data.vatEnabled,
    vatRate: parsed.data.vatRate,
    vatAmountManual: parsed.data.vatAmountManual,
  });

  await prisma.contract.update({
    where: { id: contractId },
    data: {
      date,
      number: parsed.data.number,
      companyId: parsed.data.companyId,
      counterpartyId: parsed.data.counterpartyId,
      ledgerTypeId: parsed.data.ledgerTypeId ?? null,
      amount: parsed.data.amount,
      vatEnabled: parsed.data.vatEnabled,
      vatRate: parsed.data.vatEnabled ? (parsed.data.vatRate ?? 22) : null,
      vatAmount: vat.vatAmount,
      amountWithVat: vat.amountWithVat,
      isPreliminary: parsed.data.isPreliminary,
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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Укажите название" };

  try {
    const max = await prisma.projectLedgerType.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    });
    const row = await prisma.projectLedgerType.create({
      data: {
        projectId,
        name: trimmed,
        isSystem: false,
        sortOrder: (max._max.sortOrder ?? 100) + 10,
      },
    });
    revalidateContracts(projectId);
    return { id: row.id, name: row.name };
  } catch {
    return { error: "Такой тип уже есть" };
  }
}

export async function quickCreateApprovalStatusAction(
  projectId: string,
  name: string,
  color = "#64748b",
): Promise<{ id: string; name: string; color: string } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };
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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = parseCertificateForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }
  const date = parseDate(parsed.data.date);
  if (!date) return { error: "Некорректная дата" };

  let statusId = parsed.data.statusId;
  if (!statusId) {
    const fallback = await defaultUnsignedStatusId(projectId);
    if (!fallback) return { error: "Нет статусов согласования" };
    statusId = fallback;
  }

  let paymentId = parsed.data.paymentId ?? null;
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

  const vat = computeContractVat({
    amount: parsed.data.amount,
    vatEnabled: parsed.data.vatEnabled,
    vatRate: parsed.data.vatRate,
    vatAmountManual: parsed.data.vatAmountManual,
  });

  const row = await prisma.certificate.create({
    data: {
      projectId,
      date,
      number: parsed.data.number,
      companyId,
      counterpartyId,
      contractId,
      paymentId,
      amount: parsed.data.amount,
      vatEnabled: parsed.data.vatEnabled,
      vatRate: parsed.data.vatEnabled ? (parsed.data.vatRate ?? 22) : null,
      vatAmount: vat.vatAmount,
      amountWithVat: vat.amountWithVat,
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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

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

  const vat = computeContractVat({
    amount: parsed.data.amount,
    vatEnabled: parsed.data.vatEnabled,
    vatRate: parsed.data.vatRate,
    vatAmountManual: parsed.data.vatAmountManual,
  });

  await prisma.certificate.update({
    where: { id: certificateId },
    data: {
      date,
      number: parsed.data.number,
      companyId: parsed.data.companyId,
      counterpartyId: parsed.data.counterpartyId,
      contractId: parsed.data.contractId ?? null,
      paymentId: parsed.data.paymentId ?? null,
      amount: parsed.data.amount,
      vatEnabled: parsed.data.vatEnabled,
      vatRate: parsed.data.vatEnabled ? (parsed.data.vatRate ?? 22) : null,
      vatAmount: vat.vatAmount,
      amountWithVat: vat.amountWithVat,
      statusId: parsed.data.statusId,
      summary: parsed.data.summary,
      comment: parsed.data.comment,
    },
  });

  revalidateCertificates(projectId, {
    contractId: parsed.data.contractId ?? existing.contractId,
    paymentId: parsed.data.paymentId ?? existing.paymentId,
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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.certificate.findFirst({
    where: { id: certificateId, projectId },
    select: { id: true, number: true, contractId: true, paymentId: true },
  });
  if (!existing) return { error: "Акт не найден" };

  await prisma.certificate.delete({ where: { id: certificateId } });
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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

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
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

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

/** Для формы: дефолтный статус «Не подписан». */
export async function resolveDefaultStatusIdAction(projectId: string) {
  const id = await defaultUnsignedStatusId(projectId);
  return id ? { id } : { error: "Нет статусов" as const };
}
