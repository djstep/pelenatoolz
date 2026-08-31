"use server";

import { ActorRoleType, ContractorType, Gender } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { writeAuditLog } from "@/shared/audit/log";
import { z } from "zod";
import { parseHhMmToMinutes } from "@/shared/i18n/domain-labels";

export type ActorActionState = { error?: string; success?: string };

const durationMinutes = z.preprocess((val) => {
  if (val === "" || val == null) return undefined;
  if (typeof val === "number") return val;
  return parseHhMmToMinutes(String(val));
}, z.number().int().min(0).optional());

const actorSchema = z.object({
  lastName: z.string().trim().min(1).max(100),
  firstName: z.string().trim().max(100).optional(),
  middleName: z.string().trim().max(100).optional(),
  gender: z.enum(Gender).optional(),
  contractorType: z.enum(ContractorType).optional(),
  roleType: z.enum(ActorRoleType).optional(),
  characterId: z
    .string()
    .optional()
    .transform((v) => (v === "" || !v ? undefined : v)),
  phone1: z.string().trim().max(30).optional(),
  phone2: z.string().trim().max(30).optional(),
  email: z
    .string()
    .optional()
    .transform((v) => (v === "" || !v ? undefined : v))
    .pipe(z.email().optional()),
  agentName: z.string().trim().max(100).optional(),
  agentPhone: z.string().trim().max(30).optional(),
  agentEmail: z
    .string()
    .optional()
    .transform((v) => (v === "" || !v ? undefined : v))
    .pipe(z.email().optional()),
  tags: z.string().trim().max(500).optional(),
  specialConditions: z.string().trim().max(5000).optional(),
  shiftRate: z.coerce.number().min(0).optional(),
  shiftHoursMin: durationMinutes.pipe(z.number().max(1440).optional()),
  unpaidOvertimeMin: durationMinutes.pipe(z.number().max(600).optional()),
  forceMajeurePct: z.coerce.number().min(0).max(1000).optional(),
});

function revalidateActors(projectId: string, characterId?: string) {
  revalidatePath(`/ru/projects/${projectId}/actors`);
  revalidatePath(`/ru/projects/${projectId}/characters`);
  if (characterId) {
    revalidatePath(`/ru/projects/${projectId}/characters/${characterId}`);
  }
}

function isFormValueBlank(value: FormDataEntryValue | null) {
  return value == null || String(value).trim() === "";
}

function parseOvertimeRows(formData: FormData, shiftRate: number, fkPct: number) {
  const rows: Array<{
    hourNumber: number;
    percentRate: number | null;
    amount: number | null;
    forceMajeurePct: number | null;
    forceMajeureAmt: number | null;
    totalWithFk: number | null;
  }> = [];

  for (let i = 1; i <= 24; i++) {
    const pctRaw = formData.get(`ot_pct_${i}`);
    const amountRaw = formData.get(`ot_amount_${i}`);
    if (isFormValueBlank(pctRaw) && isFormValueBlank(amountRaw)) continue;
    const percentRate = isFormValueBlank(pctRaw) ? null : Number(pctRaw);
    let amount = isFormValueBlank(amountRaw) ? null : Number(amountRaw);
    if (amount == null && percentRate != null && shiftRate > 0) {
      amount = (shiftRate * percentRate) / 100;
    }
    if (percentRate == null && amount == null) continue;
    if (Number.isNaN(percentRate ?? 0) || Number.isNaN(amount ?? 0)) continue;

    const rowFkPctRaw = formData.get(`ot_fk_${i}`);
    const rowFkPct = isFormValueBlank(rowFkPctRaw) ? fkPct : Number(rowFkPctRaw);
    const forceMajeureAmt =
      amount != null ? (amount * (rowFkPct || 0)) / 100 : null;
    const totalWithFk =
      amount != null ? amount + (forceMajeureAmt ?? 0) : null;
    rows.push({
      hourNumber: i,
      percentRate,
      amount,
      forceMajeurePct: rowFkPct,
      forceMajeureAmt,
      totalWithFk,
    });
  }
  return rows;
}

function parseExtraPayments(formData: FormData, fkPct: number) {
  const rows: Array<{
    paymentDate: Date | null;
    amount: number;
    forceMajeurePct: number | null;
    forceMajeureAmt: number | null;
    totalWithFk: number | null;
    description: string | null;
  }> = [];

  for (let i = 0; i < 50; i++) {
    const amountRaw = formData.get(`ep_amount_${i}`);
    const dateRaw = String(formData.get(`ep_date_${i}`) ?? "").trim();
    const descRaw = String(formData.get(`ep_desc_${i}`) ?? "").trim();
    if (isFormValueBlank(amountRaw) && !dateRaw && !descRaw) continue;
    const amount = isFormValueBlank(amountRaw) ? 0 : Number(amountRaw);
    if (Number.isNaN(amount)) continue;
    if (amount === 0 && !dateRaw && !descRaw) continue;

    const rowFkRaw = formData.get(`ep_fk_${i}`);
    const rowFk = isFormValueBlank(rowFkRaw) ? fkPct : Number(rowFkRaw);
    const forceMajeureAmt = (amount * (rowFk || 0)) / 100;
    rows.push({
      paymentDate: dateRaw ? new Date(dateRaw) : null,
      amount,
      forceMajeurePct: rowFk,
      forceMajeureAmt,
      totalWithFk: amount + forceMajeureAmt,
      description: descRaw || null,
    });
  }
  return rows;
}

function actorFormData(formData: FormData) {
  return {
    lastName: formData.get("lastName"),
    firstName: formData.get("firstName") || undefined,
    middleName: formData.get("middleName") || undefined,
    gender: formData.get("gender") || undefined,
    contractorType: formData.get("contractorType") || undefined,
    roleType: formData.get("roleType") || undefined,
    characterId: formData.get("characterId") || undefined,
    phone1: formData.get("phone1") || undefined,
    phone2: formData.get("phone2") || undefined,
    email: formData.get("email") || undefined,
    agentName: formData.get("agentName") || undefined,
    agentPhone: formData.get("agentPhone") || undefined,
    agentEmail: formData.get("agentEmail") || undefined,
    tags: formData.get("tags") || undefined,
    specialConditions: formData.get("specialConditions") || undefined,
    shiftRate: formData.get("shiftRate") || undefined,
    shiftHoursMin: formData.get("shiftHoursMin") || undefined,
    unpaidOvertimeMin: formData.get("unpaidOvertimeMin") || undefined,
    forceMajeurePct: formData.get("forceMajeurePct") || undefined,
  };
}

export async function createActorAction(
  projectId: string,
  _prev: ActorActionState,
  formData: FormData,
): Promise<ActorActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) {
    return { error: "Недостаточно прав" };
  }

  const parsed = actorSchema.safeParse(actorFormData(formData));
  if (!parsed.success) {
    return { error: "Проверьте данные актёра" };
  }

  const shiftRate = parsed.data.shiftRate ?? 0;
  const fkPct = parsed.data.forceMajeurePct ?? 0;
  const overtime = parseOvertimeRows(formData, shiftRate, fkPct);
  const extras = parseExtraPayments(formData, fkPct);

  const actor = await prisma.actor.create({
    data: {
      projectId,
      ...parsed.data,
      overtimeRates: overtime.length ? { create: overtime } : undefined,
      extraPayments: extras.length ? { create: extras } : undefined,
    },
  });

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "actor",
    entityId: actor.id,
    action: "CREATE",
    summary: `Добавлен актёр ${parsed.data.lastName}`,
  });

  revalidateActors(projectId, parsed.data.characterId);
  return { success: "Актёр добавлен" };
}

export async function updateActorAction(
  projectId: string,
  actorId: string,
  _prev: ActorActionState,
  formData: FormData,
): Promise<ActorActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) {
    return { error: "Недостаточно прав" };
  }

  const existing = await prisma.actor.findFirst({
    where: { id: actorId, projectId },
  });
  if (!existing) return { error: "Актёр не найден" };

  const parsed = actorSchema.safeParse(actorFormData(formData));
  if (!parsed.success) {
    return { error: "Проверьте данные актёра" };
  }

  const shiftRate = parsed.data.shiftRate ?? 0;
  const fkPct = parsed.data.forceMajeurePct ?? 0;
  const overtime = parseOvertimeRows(formData, shiftRate, fkPct);
  const extras = parseExtraPayments(formData, fkPct);

  await prisma.$transaction([
    prisma.actorOvertimeRate.deleteMany({ where: { actorId } }),
    prisma.actorExtraPayment.deleteMany({ where: { actorId } }),
    prisma.actor.update({
      where: { id: actorId },
      data: {
        ...parsed.data,
        overtimeRates: overtime.length ? { create: overtime } : undefined,
        extraPayments: extras.length ? { create: extras } : undefined,
      },
    }),
  ]);

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "actor",
    entityId: actorId,
    action: "UPDATE",
    summary: `Обновлён актёр ${parsed.data.lastName}`,
  });

  revalidateActors(projectId, existing.characterId ?? undefined);
  return { success: "Актёр сохранён" };
}

export async function deleteActorAction(projectId: string, actorId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) {
    throw new Error("FORBIDDEN");
  }

  await prisma.actor.deleteMany({ where: { id: actorId, projectId } });
  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "actor",
    entityId: actorId,
    action: "DELETE",
  });
  revalidateActors(projectId);
}
