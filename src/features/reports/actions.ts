"use server";

import { revalidatePath } from "next/cache";
import type { SceneStatus } from "@prisma/client";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { syncShootDayResourceUsages } from "@/features/schedule/lib/sync-shoot-day-resources";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";
import {
  saveProductionSceneFactSchema,
  updateProductionDayMetricsSchema,
} from "@/features/reports/schemas";

export type ReportActionState = { error?: string; success?: string };

function emptyToNull(v: string | undefined | null) {
  const t = v?.trim();
  return t ? t : null;
}

function revalidateReports(projectId: string, dayId: string) {
  revalidatePath(`/ru/projects/${projectId}/reports`);
  revalidatePath(`/ru/projects/${projectId}/reports/${dayId}`);
  revalidatePath(`/ru/projects/${projectId}/schedule`);
  revalidatePath(`/ru/projects/${projectId}/libretto`);
  revalidatePath(`/ru/projects/${projectId}/call-sheets/${dayId}`);
}

async function assertReportWrite(projectId: string, shootDayId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("report:write") && !ctx.can("schedule:write")) {
    return { error: "Недостаточно прав" } as const;
  }
  const day = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    select: { id: true },
  });
  if (!day) return { error: "Съёмочный день не найден" } as const;
  return { ctx, dayId: day.id } as const;
}

function mapFactStatusToSceneStatus(
  status: "SHOT" | "NOT_SHOT" | "RESHOOT_REQUIRED" | "DELETED",
): SceneStatus {
  switch (status) {
    case "SHOT":
      return "SHOT";
    case "RESHOOT_REQUIRED":
      return "RESHOOT_REQUIRED";
    case "DELETED":
      return "OFF_PLAN";
    case "NOT_SHOT":
    default:
      return "NOT_SHOT";
  }
}

export async function updateProductionDayMetricsAction(
  projectId: string,
  shootDayId: string,
  _prev: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const gate = await assertReportWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  const parsed = updateProductionDayMetricsSchema.safeParse({
    factShiftStart: formData.get("factShiftStart") || undefined,
    factShiftEnd: formData.get("factShiftEnd") || undefined,
    lunchStart: formData.get("lunchStart") || undefined,
    lunchEnd: formData.get("lunchEnd") || undefined,
    breakNotes: formData.get("breakNotes") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  const d = parsed.data;
  await prisma.productionReport.upsert({
    where: { shootDayId },
    create: {
      shootDayId,
      factShiftStart: emptyToNull(d.factShiftStart),
      factShiftEnd: emptyToNull(d.factShiftEnd),
      lunchStart: emptyToNull(d.lunchStart),
      lunchEnd: emptyToNull(d.lunchEnd),
      breakNotes: emptyToNull(d.breakNotes),
      notes: emptyToNull(d.notes),
    },
    update: {
      factShiftStart: emptyToNull(d.factShiftStart),
      factShiftEnd: emptyToNull(d.factShiftEnd),
      lunchStart: emptyToNull(d.lunchStart),
      lunchEnd: emptyToNull(d.lunchEnd),
      breakNotes: emptyToNull(d.breakNotes),
      notes: emptyToNull(d.notes),
    },
  });

  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.productionReport,
    entityId: shootDayId,
    action: "UPDATE",
    summary: "Обновлены общие показатели производственного отчёта",
  });

  revalidateReports(projectId, shootDayId);
  return { success: "Показатели дня сохранены" };
}

export async function saveProductionSceneFactAction(
  projectId: string,
  shootDayId: string,
  payload: unknown,
): Promise<ReportActionState> {
  const gate = await assertReportWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  const parsed = saveProductionSceneFactSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные сцены" };
  }

  const data = parsed.data;
  const scene = await prisma.scene.findFirst({
    where: { id: data.sceneId, projectId },
    select: {
      id: true,
      episodeNumber: true,
      number: true,
      postfix: true,
      title: true,
    },
  });
  if (!scene) return { error: "Сцена не найдена" };

  const report = await prisma.productionReport.upsert({
    where: { shootDayId },
    create: { shootDayId },
    update: {},
  });

  const dayLink = await prisma.shootDayScene.findFirst({
    where: { shootDayId, sceneId: data.sceneId },
    select: { id: true, sortOrder: true },
  });

  const ep = scene.episodeNumber > 0 ? `${scene.episodeNumber}-` : "";
  const sceneLabel = scene.title
    ? `${ep}${scene.number}${scene.postfix || ""} · ${scene.title}`
    : `${ep}${scene.number}${scene.postfix || ""}`;

  const shouldReturnToPool =
    data.status === "NOT_SHOT" ||
    data.status === "RESHOOT_REQUIRED" ||
    data.status === "DELETED";

  const sceneStatus = mapFactStatusToSceneStatus(data.status);

  await prisma.$transaction(async (tx) => {
    const fact = await tx.productionReportSceneFact.upsert({
      where: {
        reportId_sceneId: { reportId: report.id, sceneId: data.sceneId },
      },
      create: {
        reportId: report.id,
        sceneId: data.sceneId,
        status: data.status,
        factSeconds: data.factSeconds ?? null,
        prepStart: emptyToNull(data.prepStart),
        prepEnd: emptyToNull(data.prepEnd),
        rehearsalStart: emptyToNull(data.rehearsalStart),
        rehearsalEnd: emptyToNull(data.rehearsalEnd),
        motorStart: emptyToNull(data.motorStart),
        motorEnd: emptyToNull(data.motorEnd),
        notes: emptyToNull(data.notes),
        sortOrder: dayLink?.sortOrder ?? 0,
        returnedToPool: shouldReturnToPool,
        sceneLabel,
      },
      update: {
        status: data.status,
        factSeconds: data.factSeconds ?? null,
        prepStart: emptyToNull(data.prepStart),
        prepEnd: emptyToNull(data.prepEnd),
        rehearsalStart: emptyToNull(data.rehearsalStart),
        rehearsalEnd: emptyToNull(data.rehearsalEnd),
        motorStart: emptyToNull(data.motorStart),
        motorEnd: emptyToNull(data.motorEnd),
        notes: emptyToNull(data.notes),
        returnedToPool: shouldReturnToPool,
        sceneLabel,
      },
    });

    await tx.productionReportMontageRow.deleteMany({
      where: { sceneFactId: fact.id },
    });

    if (data.montageRows.length > 0) {
      await tx.productionReportMontageRow.createMany({
        data: data.montageRows.map((row, index) => ({
          sceneFactId: fact.id,
          scenePart: emptyToNull(row.scenePart),
          frame: emptyToNull(row.frame),
          take: emptyToNull(row.take),
          takeStatus: emptyToNull(row.takeStatus),
          takeRuntime: emptyToNull(row.takeRuntime),
          cameraFiles: row.cameraFiles,
          shotSize: emptyToNull(row.shotSize),
          sortOrder: index,
        })),
      });
    }

    await tx.scene.update({
      where: { id: data.sceneId },
      data: {
        status: sceneStatus,
        statusDate: new Date(),
        factSeconds: data.factSeconds ?? null,
      },
    });

    if (shouldReturnToPool && dayLink) {
      await tx.shootDayScene.delete({ where: { id: dayLink.id } });
    } else if (!shouldReturnToPool && !dayLink) {
      const maxOrder = await tx.shootDayScene.aggregate({
        where: { shootDayId },
        _max: { sortOrder: true },
      });
      await tx.shootDayScene.create({
        data: {
          shootDayId,
          sceneId: data.sceneId,
          sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
        },
      });
    }
  });

  if (shouldReturnToPool || (!shouldReturnToPool && !dayLink)) {
    await syncShootDayResourceUsages(shootDayId);
  }

  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.productionReport,
    entityId: shootDayId,
    action: "UPDATE",
    summary: `Факт по сцене ${sceneLabel}: ${data.status}${
      shouldReturnToPool ? " (возвращена в неспланированные)" : ""
    }`,
  });

  revalidateReports(projectId, shootDayId);
  return { success: "Факт по сцене сохранён" };
}

async function recomputeWorkRowPay(workRowId: string) {
  const row = await prisma.productionReportWorkRow.findUnique({
    where: { id: workRowId },
    include: {
      extras: true,
      actor: { include: { overtimeRates: true } },
    },
  });
  if (!row) return null;

  const { computeWorkPay } = await import("@/features/reports/lib/compute-work-pay");
  const { dec } = await import("@/shared/db/serialize-decimal");
  const extrasTotal = row.extras.reduce((s, e) => s + Number(e.amount), 0);
  const rates =
    row.actor?.overtimeRates.map((r) => ({
      hourNumber: r.hourNumber,
      percentRate: dec(r.percentRate),
      amount: dec(r.amount),
      forceMajeurePct: dec(r.forceMajeurePct),
    })) ?? [];

  const pay = computeWorkPay({
    factStart: row.factStart,
    factEnd: row.factEnd,
    lunchSkipped: row.lunchSkipped,
    shiftHoursMin: row.shiftHoursMin,
    unpaidOvertimeMin: row.unpaidOvertimeMin,
    shiftRate: dec(row.shiftRate),
    forceMajeurePct: dec(row.forceMajeurePct),
    overtimeRates: rates,
    extrasTotal,
  });

  return prisma.productionReportWorkRow.update({
    where: { id: workRowId },
    data: {
      workedMin: pay.workedMin,
      factOvertimeMin: pay.factOvertimeMin,
      payableOvertimeMin: pay.payableOvertimeMin,
      shiftPay: pay.shiftPay,
      overtimePay: pay.overtimePay,
      extrasPay: pay.extrasPay,
      totalPay: pay.totalPay,
    },
  });
}

export async function updateProductionWorkRowAction(
  projectId: string,
  shootDayId: string,
  payload: unknown,
): Promise<ReportActionState> {
  const gate = await assertReportWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  const { updateWorkRowSchema } = await import("@/features/reports/schemas");
  const parsed = updateWorkRowSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  const report = await prisma.productionReport.findUnique({
    where: { shootDayId },
    select: { id: true },
  });
  if (!report) return { error: "Отчёт не найден" };

  const row = await prisma.productionReportWorkRow.findFirst({
    where: { id: parsed.data.workRowId, reportId: report.id },
  });
  if (!row) return { error: "Строка не найдена" };

  await prisma.productionReportWorkRow.update({
    where: { id: row.id },
    data: {
      factStart: emptyToNull(parsed.data.factStart),
      factEnd: emptyToNull(parsed.data.factEnd),
      lunchSkipped: parsed.data.lunchSkipped,
    },
  });

  await recomputeWorkRowPay(row.id);

  const { syncPaymentFromWorkRow } = await import(
    "@/features/reports/lib/sync-payment"
  );
  await syncPaymentFromWorkRow(projectId, shootDayId, row.id);

  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.productionReport,
    entityId: shootDayId,
    action: "UPDATE",
    summary: `Факт работы: ${row.displayName}${
      parsed.data.lunchSkipped ? " (Т/О)" : ""
    }`,
  });

  revalidateReports(projectId, shootDayId);
  revalidatePath(`/ru/projects/${projectId}/finance`);
  return { success: "Факт работы сохранён" };
}

export async function saveProductionWorkExtrasAction(
  projectId: string,
  shootDayId: string,
  payload: unknown,
): Promise<ReportActionState> {
  const gate = await assertReportWrite(projectId, shootDayId);
  if ("error" in gate) return gate;

  const { saveWorkExtrasSchema } = await import("@/features/reports/schemas");
  const parsed = saveWorkExtrasSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте выплаты" };
  }

  const report = await prisma.productionReport.findUnique({
    where: { shootDayId },
    select: { id: true },
  });
  if (!report) return { error: "Отчёт не найден" };

  const row = await prisma.productionReportWorkRow.findFirst({
    where: { id: parsed.data.workRowId, reportId: report.id },
  });
  if (!row) return { error: "Строка не найдена" };

  await prisma.$transaction(async (tx) => {
    await tx.productionReportWorkExtra.deleteMany({
      where: { workRowId: row.id },
    });
    const filled = parsed.data.extras.filter(
      (e) => e.amount !== 0 || (e.description && e.description.trim()),
    );
    if (filled.length > 0) {
      await tx.productionReportWorkExtra.createMany({
        data: filled.map((e) => ({
          workRowId: row.id,
          amount: e.amount,
          description: emptyToNull(e.description),
        })),
      });
    }
  });

  await recomputeWorkRowPay(row.id);
  const { syncPaymentFromWorkRow } = await import(
    "@/features/reports/lib/sync-payment"
  );
  await syncPaymentFromWorkRow(projectId, shootDayId, row.id);

  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.payment,
    entityId: row.id,
    action: "UPDATE",
    summary: `Доп. выплаты: ${row.displayName}`,
  });

  revalidateReports(projectId, shootDayId);
  revalidatePath(`/ru/projects/${projectId}/finance`);
  return { success: "Дополнительные выплаты сохранены" };
}

