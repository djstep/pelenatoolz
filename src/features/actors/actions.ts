"use server";

import { ActorRoleType, ContractorType, Gender } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { z } from "zod";
import { parseHhMmToMinutes } from "@/shared/i18n/domain-labels";
import { parseExtraPaymentFormRows } from "@/features/payroll/lib/parse-extra-payments";
import { parseOvertimeFormRows } from "@/features/payroll/lib/parse-overtime-form";

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
  taxPercent: z.coerce.number().min(0).max(1000).optional(),
  pickupOffsetMin: durationMinutes.pipe(z.number().max(600).optional()),
  overtimeMode: z
    .enum(["HALF_HOUR", "HOURLY_CUMULATIVE", "HOURLY_FLAT"])
    .optional(),
  unpaidOvertimeMode: z.enum(["FIRST_HOUR", "EACH_HOUR"]).optional(),
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

function parseOvertimeRows(formData: FormData, shiftRate: number, taxPct: number) {
  return parseOvertimeFormRows(formData, shiftRate, taxPct);
}

function parseExtraPayments(formData: FormData, taxPct: number) {
  return parseExtraPaymentFormRows(formData, taxPct);
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
    taxPercent: formData.get("taxPercent") || undefined,
    pickupOffsetMin: formData.get("pickupOffsetMin") || undefined,
    overtimeMode: formData.get("overtimeMode") || undefined,
    unpaidOvertimeMode: formData.get("unpaidOvertimeMode") || undefined,
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

  const canFin = ctx.canFinanceWrite("actors");
  const {
    shiftRate,
    shiftHoursMin,
    unpaidOvertimeMin,
    taxPercent,
    pickupOffsetMin,
    overtimeMode,
    unpaidOvertimeMode,
    ...profile
  } = parsed.data;

  const overtime = canFin
    ? parseOvertimeRows(formData, shiftRate ?? 0, taxPercent ?? 0)
    : [];
  const extras = canFin
    ? parseExtraPayments(formData, taxPercent ?? 0)
    : [];

  const actor = await prisma.actor.create({
    data: {
      projectId,
      ...profile,
      ...(canFin
        ? {
            shiftRate,
            shiftHoursMin,
            unpaidOvertimeMin,
            taxPercent,
            pickupOffsetMin,
            overtimeMode,
            unpaidOvertimeMode,
            overtimeRates: overtime.length ? { create: overtime } : undefined,
            extraPayments: extras.length ? { create: extras } : undefined,
          }
        : {}),
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.actor,
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

  const canFin = ctx.canFinanceWrite("actors");
  const {
    shiftRate,
    shiftHoursMin,
    unpaidOvertimeMin,
    taxPercent,
    pickupOffsetMin,
    overtimeMode,
    unpaidOvertimeMode,
    ...profile
  } = parsed.data;

  if (canFin) {
    const overtime = parseOvertimeRows(
      formData,
      shiftRate ?? 0,
      taxPercent ?? 0,
    );
    const extras = parseExtraPayments(formData, taxPercent ?? 0);
    await prisma.$transaction([
      prisma.actorOvertimeRate.deleteMany({ where: { actorId } }),
      prisma.actorExtraPayment.deleteMany({ where: { actorId } }),
      prisma.actor.update({
        where: { id: actorId },
        data: {
          ...profile,
          shiftRate,
          shiftHoursMin,
          unpaidOvertimeMin,
          taxPercent,
          pickupOffsetMin,
          overtimeMode,
          unpaidOvertimeMode,
          overtimeRates: overtime.length ? { create: overtime } : undefined,
          extraPayments: extras.length ? { create: extras } : undefined,
        },
      }),
    ]);
  } else {
    await prisma.actor.update({
      where: { id: actorId },
      data: profile,
    });
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.actor,
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
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.actor,
    entityId: actorId,
    action: "DELETE",
    summary: "Удалён актёр",
  });
  revalidateActors(projectId);
}
