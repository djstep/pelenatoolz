"use server";

import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  assignSceneSchema,
  createShootDaySchema,
  reorderScenesSchema,
  updateShootDaySchema,
} from "@/features/script/schemas";
import { prisma } from "@/shared/db/prisma";
import { writeAuditLog } from "@/shared/audit/log";
import { eachCalendarDay, parseDateInput } from "@/features/schedule/lib/date-range";

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

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "shoot_day",
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

export async function deleteShootDayAction(projectId: string, shootDayId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    throw new Error("FORBIDDEN");
  }

  await prisma.shootDay.deleteMany({ where: { id: shootDayId, projectId } });
  revalidateSchedule(projectId);
}

export async function assignSceneToDayAction(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    return { error: "Недостаточно прав" };
  }

  const parsed = assignSceneSchema.safeParse({
    shootDayId: formData.get("shootDayId"),
    sceneId: formData.get("sceneId"),
  });

  if (!parsed.success) {
    return { error: "Некорректные данные" };
  }

  const shootDay = await prisma.shootDay.findFirst({
    where: { id: parsed.data.shootDayId, projectId },
  });
  const scene = await prisma.scene.findFirst({
    where: { id: parsed.data.sceneId, projectId },
  });

  if (!shootDay || !scene) {
    return { error: "Сцена или день не найдены" };
  }

  const maxOrder = await prisma.shootDayScene.aggregate({
    where: { shootDayId: parsed.data.shootDayId },
    _max: { sortOrder: true },
  });

  try {
    await prisma.shootDayScene.create({
      data: {
        shootDayId: parsed.data.shootDayId,
        sceneId: parsed.data.sceneId,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
        estimatedPages: scene.pageCount,
      },
    });
  } catch {
    return { error: "Сцена уже в этом дне" };
  }

  revalidateSchedule(projectId);
  return { success: "Сцена добавлена в день" };
}

export async function assignSceneToDayByDnDAction(
  projectId: string,
  shootDayId: string,
  sceneId: string,
) {
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

  const existing = await prisma.shootDayScene.findFirst({
    where: { sceneId },
  });
  if (existing) {
    if (existing.shootDayId === shootDayId) return;
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

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "shoot_day_scene",
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
      date: parsed.data.date ? new Date(parsed.data.date) : undefined,
    },
  });

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "shoot_day",
    entityId: shootDayId,
    action: "UPDATE",
    summary: "Обновлён съёмочный день",
    changes: parsed.data as Record<string, unknown>,
  });

  revalidateSchedule(projectId);
}

export async function removeSceneFromDayAction(
  projectId: string,
  shootDaySceneId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    throw new Error("FORBIDDEN");
  }

  await prisma.shootDayScene.deleteMany({
    where: {
      id: shootDaySceneId,
      shootDay: { projectId },
    },
  });

  revalidateSchedule(projectId);
}

export async function moveSceneInDayAction(
  projectId: string,
  shootDaySceneId: string,
  direction: "up" | "down",
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write")) {
    throw new Error("FORBIDDEN");
  }

  const current = await prisma.shootDayScene.findFirst({
    where: { id: shootDaySceneId, shootDay: { projectId } },
  });

  if (!current) return;

  const siblings = await prisma.shootDayScene.findMany({
    where: { shootDayId: current.shootDayId },
    orderBy: { sortOrder: "asc" },
  });

  const index = siblings.findIndex((s) => s.id === current.id);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= siblings.length) return;

  const other = siblings[swapIndex];
  await prisma.$transaction([
    prisma.shootDayScene.update({
      where: { id: current.id },
      data: { sortOrder: other.sortOrder },
    }),
    prisma.shootDayScene.update({
      where: { id: other.id },
      data: { sortOrder: current.sortOrder },
    }),
  ]);

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

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "shoot_day",
    entityId: shootDayId,
    action: "UPDATE",
    summary: "День очищен от сцен",
  });

  revalidateSchedule(projectId);
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

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "shoot_day",
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

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "shoot_day",
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

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "shoot_day",
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

  await prisma.shootDay.deleteMany({ where: { projectId } });

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "shoot_day",
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
