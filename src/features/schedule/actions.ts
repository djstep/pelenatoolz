"use server";

import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  createShootDaySchema,
  reorderScenesSchema,
  updateShootDaySchema,
} from "@/features/script/schemas";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { zeroAccrualsOfWorkRows } from "@/features/reports/lib/sync-accruals";
import { eachCalendarDay, parseDateInput } from "@/features/schedule/lib/date-range";
import { isWorkingShootDay } from "@/features/schedule/lib/shoot-day-type";
import { syncShootDayResourceUsages } from "@/features/schedule/lib/sync-shoot-day-resources";

export type ActionState = { error?: string; success?: string };

function revalidateSchedule(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/schedule`);
  revalidatePath(`/ru/projects/${projectId}/call-sheets`);
  revalidatePath(`/ru/projects/${projectId}/reports`);
  revalidatePath(`/ru/projects/${projectId}/libretto`);
  revalidatePath(`/ru/projects/${projectId}`);
}

export async function createShootDayAction(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    return { error: "Недостаточно прав" };
  }

  const parsed = createShootDaySchema.safeParse({
    dateFrom: formData.get("dateFrom"),
    dateTo: formData.get("dateTo") || undefined,
    dayNumber: formData.get("dayNumber"),
    callTime: formData.get("callTime") || undefined,
    wrapTime: formData.get("wrapTime") || undefined,
    notes: formData.get("notes") || undefined,
    status: formData.get("status") || undefined,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message;
    return { error: issue ?? "Проверьте данные съёмочного дня" };
  }

  const from = parseDateInput(parsed.data.dateFrom);
  const to = parseDateInput(parsed.data.dateTo);
  if (!from || !to) {
    return { error: "Некорректные даты периода" };
  }

  const dates = eachCalendarDay(from, to);

  try {
    await prisma.$transaction(
      dates.map((date, index) =>
        prisma.shootDay.create({
          data: {
            projectId,
            date,
            dayNumber: parsed.data.dayNumber + index,
            callTime: parsed.data.callTime,
            wrapTime: parsed.data.wrapTime,
            notes: parsed.data.notes,
            status: parsed.data.status,
            dayType: parsed.data.dayType,
            isNightShift: parsed.data.isNightShift,
          },
        }),
      ),
    );
  } catch {
    return { error: "Конфликт номеров дней — проверьте период и стартовый номер" };
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.shootDay,
    entityId: projectId,
    action: "CREATE",
    summary:
      dates.length === 1
        ? `Добавлен съёмочный день ${parsed.data.dayNumber}`
        : `Добавлено ${dates.length} съёмочных дней (${parsed.data.dayNumber}–${parsed.data.dayNumber + dates.length - 1})`,
  });

  revalidateSchedule(projectId);
  return {
    success:
      dates.length === 1
        ? "Съёмочный день добавлен"
        : `Добавлено ${dates.length} съёмочных дней`,
  };
}

export async function assignSceneToDayByDnDAction(
  projectId: string,
  shootDayId: string,
  sceneId: string,
): Promise<{ error?: string } | undefined> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    throw new Error("FORBIDDEN");
  }

  const shootDay = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId, isLocked: false },
  });
  const scene = await prisma.scene.findFirst({
    where: { id: sceneId, projectId },
  });

  if (!shootDay || !scene) return;

  if (!isWorkingShootDay(shootDay.dayType)) return;

  const existing = await prisma.shootDayScene.findFirst({
    where: { sceneId },
  });
  if (existing?.shootDayId === shootDayId) return;
  // Вырезанную сцену нельзя поставить в день — ни из списка «без дня», ни переносом из другого дня.
  if (scene.cutAt) {
    return { error: `Сцена ${scene.number}${scene.postfix} вырезана — в день не добавить` };
  }

  let previousDayId: string | null = null;
  if (existing) {
    previousDayId = existing.shootDayId;
    await prisma.shootDayScene.delete({ where: { id: existing.id } });
  }

  const maxOrder = await prisma.shootDayScene.aggregate({
    where: { shootDayId },
    _max: { sortOrder: true },
  });

  await prisma.shootDayScene.create({
    data: {
      shootDayId,
      sceneId,
      sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      estimatedPages: scene.pageCount,
    },
  });

  await syncShootDayResourceUsages(shootDayId);
  if (previousDayId) {
    await syncShootDayResourceUsages(previousDayId);
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.scene,
    entityId: sceneId,
    action: "UPDATE",
    summary: `Сцена ${scene.number} назначена на день ${shootDay.dayNumber}`,
  });

  revalidateSchedule(projectId);
}

export async function updateShootDayAction(
  projectId: string,
  shootDayId: string,
  data: {
    dayType?: import("@prisma/client").ShootDayType;
    isLocked?: boolean;
    isNightShift?: boolean;
    comment?: string;
    prepNote?: string;
    date?: string;
  },
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    throw new Error("FORBIDDEN");
  }

  const parsed = updateShootDaySchema.safeParse(data);
  if (!parsed.success) return;

  await prisma.shootDay.updateMany({
    where: { id: shootDayId, projectId },
    data: {
      dayType: parsed.data.dayType,
      isLocked: parsed.data.isLocked,
      isNightShift: parsed.data.isNightShift,
      comment: parsed.data.comment,
      prepNote: parsed.data.prepNote,
      date: parsed.data.date ? new Date(parsed.data.date) : undefined,
    } as Parameters<typeof prisma.shootDay.updateMany>[0]["data"],
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.shootDay,
    entityId: shootDayId,
    action: "UPDATE",
    summary: "Обновлён съёмочный день",
    changes: parsed.data as Record<string, unknown>,
  });

  revalidateSchedule(projectId);
}

export async function reorderScenesAction(
  projectId: string,
  shootDayId: string,
  orderedIds: string[],
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    throw new Error("FORBIDDEN");
  }

  const parsed = reorderScenesSchema.safeParse({ shootDayId, orderedIds });
  if (!parsed.success) return;

  const shootDay = await prisma.shootDay.findFirst({
    where: { id: parsed.data.shootDayId, projectId },
    select: { dayType: true, isLocked: true },
  });
  if (
    !shootDay ||
    !isWorkingShootDay(shootDay.dayType) ||
    shootDay.isLocked
  ) {
    return;
  }

  await prisma.$transaction(
    parsed.data.orderedIds.map((id, index) =>
      prisma.shootDayScene.updateMany({
        where: {
          id,
          shootDayId: parsed.data.shootDayId,
          shootDay: { projectId },
        },
        data: { sortOrder: index + 1 },
      }),
    ),
  );

  revalidateSchedule(projectId);
}

export async function clearShootDayAction(
  projectId: string,
  shootDayId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    throw new Error("FORBIDDEN");
  }

  await prisma.shootDayScene.deleteMany({
    where: { shootDayId, shootDay: { projectId } },
  });

  await syncShootDayResourceUsages(shootDayId);

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.shootDay,
    entityId: shootDayId,
    action: "UPDATE",
    summary: "День очищен от сцен",
  });

  revalidateSchedule(projectId);
}

/** Что будет при «Убрать из дня» — для окна подтверждения. Только чтение. */
export async function getSceneDayRemoveImpactAction(
  projectId: string,
  shootDayId: string,
  sceneId: string,
): Promise<string[]> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) return [];
  const facts = await prisma.productionReportSceneFact.count({
    where: { sceneId, scene: { projectId }, report: { shootDayId, shootDay: { projectId } } },
  });
  const lines = ["Сама сцена, отчёты смены и история съёмок не меняются"];
  if (facts > 0) {
    lines.push("По сцене в этот день есть факт в отчёте смены — он останется в отчёте без изменений");
  }
  return lines;
}

/** Убрать одну сцену из дня КПП. Сцена, отчёты смены и история съёмок не меняются. */
export async function removeSceneFromDayAction(
  projectId: string,
  shootDayId: string,
  sceneId: string,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    return { error: "Недостаточно прав" };
  }

  const link = await prisma.shootDayScene.findFirst({
    where: { shootDayId, sceneId, shootDay: { projectId }, scene: { projectId } },
    select: {
      id: true,
      shootDay: { select: { dayNumber: true, isLocked: true } },
      scene: { select: { number: true, postfix: true, episodeNumber: true } },
    },
  });
  if (!link) return { error: "Сцены нет в этом дне" };
  if (link.shootDay.isLocked) {
    return { error: "День зафиксирован — сначала снимите фиксацию" };
  }

  await prisma.shootDayScene.delete({ where: { id: link.id } });
  await syncShootDayResourceUsages(shootDayId);

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.scene,
    entityId: sceneId,
    action: "UPDATE",
    summary: `Сцена ${link.scene.number}${link.scene.postfix} убрана из дня ${link.shootDay.dayNumber}`,
  });

  revalidateSchedule(projectId);
  return {};
}

export async function insertShootDayBeforeAction(
  projectId: string,
  beforeDayId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    throw new Error("FORBIDDEN");
  }

  const before = await prisma.shootDay.findFirst({
    where: { id: beforeDayId, projectId },
  });
  if (!before) return;

  const later = await prisma.shootDay.findMany({
    where: { projectId, dayNumber: { gte: before.dayNumber } },
    orderBy: { dayNumber: "desc" },
  });

  // Shift day numbers up from the end to avoid unique conflicts
  await prisma.$transaction(async (tx) => {
    for (const day of later) {
      await tx.shootDay.update({
        where: { id: day.id },
        data: { dayNumber: day.dayNumber + 1 },
      });
    }

    const insertDate = new Date(before.date);
    insertDate.setDate(insertDate.getDate() - 1);

    await tx.shootDay.create({
      data: {
        projectId,
        dayNumber: before.dayNumber,
        date: insertDate,
        dayType: "WORKING",
      },
    });
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.shootDay,
    entityId: beforeDayId,
    action: "CREATE",
    summary: `Вставлен день слева от дня ${before.dayNumber}`,
  });

  revalidateSchedule(projectId);
}

export async function insertShootDayAfterAction(
  projectId: string,
  afterDayId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    throw new Error("FORBIDDEN");
  }

  const after = await prisma.shootDay.findFirst({
    where: { id: afterDayId, projectId },
  });
  if (!after) return;

  const later = await prisma.shootDay.findMany({
    where: { projectId, dayNumber: { gt: after.dayNumber } },
    orderBy: { dayNumber: "desc" },
  });

  await prisma.$transaction(async (tx) => {
    for (const day of later) {
      await tx.shootDay.update({
        where: { id: day.id },
        data: { dayNumber: day.dayNumber + 1 },
      });
    }

    const insertDate = new Date(after.date);
    insertDate.setDate(insertDate.getDate() + 1);

    await tx.shootDay.create({
      data: {
        projectId,
        dayNumber: after.dayNumber + 1,
        date: insertDate,
        dayType: "WORKING",
      },
    });
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.shootDay,
    entityId: afterDayId,
    action: "CREATE",
    summary: `Вставлен день справа от дня ${after.dayNumber}`,
  });

  revalidateSchedule(projectId);
}

export async function deleteShootDayWithShiftAction(
  projectId: string,
  shootDayId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    throw new Error("FORBIDDEN");
  }

  const target = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
  });
  if (!target) return;

  // Начисления из отчёта этого дня остаются: сумма 0 и пометка «обнулено в отчёте».
  const workRows = await prisma.productionReportWorkRow.findMany({
    where: { report: { shootDayId } },
    select: { id: true },
  });
  await zeroAccrualsOfWorkRows(
    ctx,
    projectId,
    workRows.map((r) => r.id),
  );

  await prisma.$transaction(async (tx) => {
    await tx.shootDay.delete({ where: { id: shootDayId } });
    const later = await tx.shootDay.findMany({
      where: { projectId, dayNumber: { gt: target.dayNumber } },
      orderBy: { dayNumber: "asc" },
    });
    for (const day of later) {
      await tx.shootDay.update({
        where: { id: day.id },
        data: { dayNumber: day.dayNumber - 1 },
      });
    }
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.shootDay,
    entityId: shootDayId,
    action: "DELETE",
    summary: `Удалён день ${target.dayNumber} со сдвигом`,
  });

  revalidateSchedule(projectId);
}

export async function clearScheduleCalendarAction(
  projectId: string,
): Promise<ActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    return { error: "Недостаточно прав" };
  }

  const [dayCount, assignedCount] = await Promise.all([
    prisma.shootDay.count({ where: { projectId } }),
    prisma.shootDayScene.count({ where: { shootDay: { projectId } } }),
  ]);

  if (dayCount === 0) {
    return { success: "Календарь уже пуст" };
  }

  // Начисления из отчётов остаются: сумма 0 и пометка «обнулено в отчёте».
  const workRows = await prisma.productionReportWorkRow.findMany({
    where: { report: { shootDay: { projectId } } },
    select: { id: true },
  });
  await zeroAccrualsOfWorkRows(
    ctx,
    projectId,
    workRows.map((r) => r.id),
  );

  await prisma.shootDay.deleteMany({ where: { projectId } });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.shootDay,
    entityId: projectId,
    action: "DELETE",
    summary: `Календарь очищен: удалено ${dayCount} съёмочных дней, ${assignedCount} назначений сцен`,
  });

  revalidateSchedule(projectId);
  return {
    success:
      assignedCount > 0
        ? `Календарь очищен: ${dayCount} дн., ${assignedCount} сцен возвращено в неспланированные`
        : `Календарь очищен: удалено ${dayCount} съёмочных дней`,
  };
}

function calendarDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Перенос даты съёмочного дня; если дата занята — меняет даты местами. */
export async function moveShootDayToDateAction(
  projectId: string,
  shootDayId: string,
  targetDate: string,
): Promise<ActionState & { redirectDayId?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write") && !ctx.can("callsheet:write")) {
    return { error: "Недостаточно прав" };
  }

  const parsedDate = parseDateInput(targetDate);
  if (!parsedDate) return { error: "Укажите корректную дату" };

  const source = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    select: {
      id: true,
      dayNumber: true,
      date: true,
      isLocked: true,
      callSheetPlanLocked: true,
    },
  });
  if (!source) return { error: "Съёмочный день не найден" };
  if (source.isLocked || source.callSheetPlanLocked) {
    return { error: "День зафиксирован — сначала снимите блокировку" };
  }

  const targetKey = calendarDateKey(parsedDate);
  if (calendarDateKey(source.date) === targetKey) {
    return { error: "День уже на этой дате" };
  }

  const siblings = await prisma.shootDay.findMany({
    where: { projectId, id: { not: shootDayId } },
    select: { id: true, dayNumber: true, date: true, isLocked: true, callSheetPlanLocked: true },
  });

  const occupant = siblings.find((day) => calendarDateKey(day.date) === targetKey);

  if (!occupant) {
    await prisma.shootDay.update({
      where: { id: source.id },
      data: { date: parsedDate },
    });

    await recordAudit(ctx, {
      projectId,
      entityType: AuditEntityType.shootDay,
      entityId: source.id,
      action: "UPDATE",
      summary: `День ${source.dayNumber} перенесён на ${targetKey}`,
    });

    revalidateSchedule(projectId);
    revalidatePath(`/ru/projects/${projectId}/call-sheets/${source.id}`);
    return {
      success: `День ${source.dayNumber} перенесён на ${targetKey}`,
      redirectDayId: source.id,
    };
  }

  if (occupant.isLocked || occupant.callSheetPlanLocked) {
    return {
      error: `На ${targetKey} уже день ${occupant.dayNumber} (зафиксирован) — сначала снимите блокировку`,
    };
  }

  const sourceDate = source.date;
  await prisma.$transaction([
    prisma.shootDay.update({
      where: { id: source.id },
      data: { date: occupant.date },
    }),
    prisma.shootDay.update({
      where: { id: occupant.id },
      data: { date: sourceDate },
    }),
  ]);

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.shootDay,
    entityId: source.id,
    action: "UPDATE",
    summary: `Дни ${source.dayNumber} и ${occupant.dayNumber} поменялись датами (${targetKey})`,
  });

  revalidateSchedule(projectId);
  revalidatePath(`/ru/projects/${projectId}/call-sheets/${source.id}`);
  revalidatePath(`/ru/projects/${projectId}/call-sheets/${occupant.id}`);
  return {
    success: `Дни ${source.dayNumber} и ${occupant.dayNumber} поменялись датами`,
    redirectDayId: source.id,
  };
}
