"use server";

import { ActorRoleType, ContractorType, Gender } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { writeAuditLog } from "@/shared/audit/log";
import { z } from "zod";

export type ActorActionState = { error?: string; success?: string };

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
  carPickupTime: z.string().trim().max(5).optional(),
  arrivalTime: z.string().trim().max(5).optional(),
  tags: z.string().trim().max(500).optional(),
  specialConditions: z.string().trim().max(5000).optional(),
  shiftRate: z.coerce.number().min(0).optional(),
  shiftHoursMin: z.coerce.number().int().min(0).max(1440).optional(),
  unpaidOvertimeMin: z.coerce.number().int().min(0).max(600).optional(),
  forceMajeurePct: z.coerce.number().min(0).max(1000).optional(),
});

function revalidateActors(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/actors`);
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
    if (pctRaw == null && amountRaw == null) continue;
    const percentRate = pctRaw === "" || pctRaw == null ? null : Number(pctRaw);
    let amount =
      amountRaw === "" || amountRaw == null ? null : Number(amountRaw);
    if (amount == null && percentRate != null && shiftRate > 0) {
      amount = (shiftRate * percentRate) / 100;
    }
    const rowFkPctRaw = formData.get(`ot_fk_${i}`);
    const rowFkPct =
      rowFkPctRaw === "" || rowFkPctRaw == null
        ? fkPct
        : Number(rowFkPctRaw);
    const forceMajeureAmt =
      amount != null ? (amount * (rowFkPct || 0)) / 100 : null;
    const totalWithFk =
      amount != null ? amount + (forceMajeureAmt ?? 0) : null;
    if (percentRate == null && amount == null) continue;
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
    if (amountRaw == null || amountRaw === "") continue;
    const amount = Number(amountRaw);
    if (Number.isNaN(amount)) continue;
    const dateRaw = String(formData.get(`ep_date_${i}`) ?? "");
    const rowFk =
      formData.get(`ep_fk_${i}`) === "" || formData.get(`ep_fk_${i}`) == null
        ? fkPct
        : Number(formData.get(`ep_fk_${i}`));
    const forceMajeureAmt = (amount * (rowFk || 0)) / 100;
    rows.push({
      paymentDate: dateRaw ? new Date(dateRaw) : null,
      amount,
      forceMajeurePct: rowFk,
      forceMajeureAmt,
      totalWithFk: amount + forceMajeureAmt,
      description: String(formData.get(`ep_desc_${i}`) ?? "") || null,
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
    carPickupTime: formData.get("carPickupTime") || undefined,
    arrivalTime: formData.get("arrivalTime") || undefined,
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

  revalidateActors(projectId);
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

  revalidateActors(projectId);
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
