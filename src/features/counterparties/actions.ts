"use server";

import { CounterpartyType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  companySchema,
  counterpartySchema,
} from "@/features/counterparties/schemas";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";

export type CounterpartiesActionState = {
  error?: string;
  success?: string;
  id?: string;
  name?: string;
};

function revalidateCounterparties(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/counterparties`);
  revalidatePath(`/ru/projects/${projectId}/finance`);
}

function emptyToUndef(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  return s || undefined;
}

export async function createCompanyAction(
  projectId: string,
  _prev: CounterpartiesActionState,
  formData: FormData,
): Promise<CounterpartiesActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = companySchema.safeParse({
    name: formData.get("name"),
    requisites: emptyToUndef(formData.get("requisites")),
    inn: emptyToUndef(formData.get("inn")),
    notes: emptyToUndef(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  const row = await prisma.company.create({
    data: {
      projectId,
      name: parsed.data.name,
      requisites: parsed.data.requisites ?? null,
      inn: parsed.data.inn ?? null,
      notes: parsed.data.notes ?? null,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.company,
    entityId: row.id,
    action: "CREATE",
    summary: `Добавлена компания ${row.name}`,
  });

  revalidateCounterparties(projectId);
  return { success: "Компания добавлена", id: row.id, name: row.name };
}

export async function updateCompanyAction(
  projectId: string,
  companyId: string,
  _prev: CounterpartiesActionState,
  formData: FormData,
): Promise<CounterpartiesActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = companySchema.safeParse({
    name: formData.get("name"),
    requisites: emptyToUndef(formData.get("requisites")),
    inn: emptyToUndef(formData.get("inn")),
    notes: emptyToUndef(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  const result = await prisma.company.updateMany({
    where: { id: companyId, projectId },
    data: {
      name: parsed.data.name,
      requisites: parsed.data.requisites ?? null,
      inn: parsed.data.inn ?? null,
      notes: parsed.data.notes ?? null,
    },
  });
  if (result.count === 0) return { error: "Компания не найдена" };

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.company,
    entityId: companyId,
    action: "UPDATE",
    summary: `Обновлена компания ${parsed.data.name}`,
  });

  revalidateCounterparties(projectId);
  return { success: "Сохранено", id: companyId, name: parsed.data.name };
}

export async function deleteCompanyAction(projectId: string, companyId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) throw new Error("FORBIDDEN");

  const existing = await prisma.company.findFirst({
    where: { id: companyId, projectId },
    select: { id: true, name: true },
  });
  if (!existing) throw new Error("NOT_FOUND");

  await prisma.company.delete({ where: { id: companyId } });
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.company,
    entityId: companyId,
    action: "DELETE",
    summary: `Удалена компания ${existing.name}`,
  });
  revalidateCounterparties(projectId);
}

export async function createCounterpartyAction(
  projectId: string,
  _prev: CounterpartiesActionState,
  formData: FormData,
): Promise<CounterpartiesActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = counterpartySchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type") || CounterpartyType.LEGAL_ENTITY,
    contacts: emptyToUndef(formData.get("contacts")),
    inn: emptyToUndef(formData.get("inn")),
    notes: emptyToUndef(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  const row = await prisma.counterparty.create({
    data: {
      projectId,
      name: parsed.data.name,
      type: parsed.data.type,
      contacts: parsed.data.contacts ?? null,
      inn: parsed.data.inn ?? null,
      notes: parsed.data.notes ?? null,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.counterparty,
    entityId: row.id,
    action: "CREATE",
    summary: `Добавлен контрагент ${row.name}`,
  });

  revalidateCounterparties(projectId);
  return { success: "Контрагент добавлен", id: row.id, name: row.name };
}

export async function updateCounterpartyAction(
  projectId: string,
  counterpartyId: string,
  _prev: CounterpartiesActionState,
  formData: FormData,
): Promise<CounterpartiesActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = counterpartySchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type") || CounterpartyType.LEGAL_ENTITY,
    contacts: emptyToUndef(formData.get("contacts")),
    inn: emptyToUndef(formData.get("inn")),
    notes: emptyToUndef(formData.get("notes")),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  const result = await prisma.counterparty.updateMany({
    where: { id: counterpartyId, projectId },
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      contacts: parsed.data.contacts ?? null,
      inn: parsed.data.inn ?? null,
      notes: parsed.data.notes ?? null,
    },
  });
  if (result.count === 0) return { error: "Контрагент не найден" };

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.counterparty,
    entityId: counterpartyId,
    action: "UPDATE",
    summary: `Обновлён контрагент ${parsed.data.name}`,
  });

  revalidateCounterparties(projectId);
  return {
    success: "Сохранено",
    id: counterpartyId,
    name: parsed.data.name,
  };
}

export async function deleteCounterpartyAction(
  projectId: string,
  counterpartyId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) throw new Error("FORBIDDEN");

  const existing = await prisma.counterparty.findFirst({
    where: { id: counterpartyId, projectId },
    select: { id: true, name: true },
  });
  if (!existing) throw new Error("NOT_FOUND");

  await prisma.counterparty.delete({ where: { id: counterpartyId } });
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.counterparty,
    entityId: counterpartyId,
    action: "DELETE",
    summary: `Удалён контрагент ${existing.name}`,
  });
  revalidateCounterparties(projectId);
}

/** Quick-create from finance forms — returns id/name for picker. */
export async function quickCreateCompanyAction(
  projectId: string,
  name: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = companySchema.safeParse({ name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  const row = await prisma.company.create({
    data: { projectId, name: parsed.data.name },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.company,
    entityId: row.id,
    action: "CREATE",
    summary: `Добавлена компания ${row.name}`,
  });
  revalidateCounterparties(projectId);
  return { id: row.id, name: row.name };
}

export async function quickCreateCounterpartyAction(
  projectId: string,
  name: string,
  type: CounterpartyType = CounterpartyType.LEGAL_ENTITY,
): Promise<{ id: string; name: string } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = counterpartySchema.safeParse({ name, type });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  const row = await prisma.counterparty.create({
    data: {
      projectId,
      name: parsed.data.name,
      type: parsed.data.type,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.counterparty,
    entityId: row.id,
    action: "CREATE",
    summary: `Добавлен контрагент ${row.name}`,
  });
  revalidateCounterparties(projectId);
  return { id: row.id, name: row.name };
}
