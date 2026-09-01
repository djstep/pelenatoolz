"use server";

import { ActorAvailabilityStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nextManualStatus, parseDateKey } from "@/features/actor-availability/lib/status";
import {
  buildKppActorBusyMap,
  ensureAvailabilityRowForActor,
  ensureAvailabilityRowForCastingPerson,
} from "@/features/actor-availability/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

function revalidateAvailability(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/schedule/availability`);
  revalidatePath(`/ru/projects/${projectId}/schedule`);
  revalidatePath(`/ru/projects/${projectId}/preproduction/casting`);
  revalidatePath(`/ru/projects/${projectId}/characters`);
}

export async function addActorToAvailabilityCalendarAction(
  projectId: string,
  actorId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write") && !ctx.can("cast:write")) {
    return { error: "Недостаточно прав" };
  }
  try {
    await ensureAvailabilityRowForActor(projectId, actorId);
    revalidateAvailability(projectId);
    return { success: "Актёр добавлен в календарь" };
  } catch {
    return { error: "Не удалось добавить актёра" };
  }
}

export async function addCastingPersonToAvailabilityCalendarAction(
  projectId: string,
  castingPersonId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write") && !ctx.can("cast:write")) {
    return { error: "Недостаточно прав" };
  }
  try {
    await ensureAvailabilityRowForCastingPerson(projectId, castingPersonId);
    revalidateAvailability(projectId);
    return { success: "Кандидат добавлен в календарь" };
  } catch {
    return { error: "Не удалось добавить в календарь" };
  }
}

export async function removeAvailabilityRowAction(
  projectId: string,
  rowId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write") && !ctx.can("cast:write")) {
    return { error: "Недостаточно прав" };
  }

  await prisma.actorAvailabilityRow.deleteMany({
    where: { id: rowId, projectId },
  });
  revalidateAvailability(projectId);
  return { success: "Строка удалена из календаря" };
}

export async function setAvailabilityDayAction(
  projectId: string,
  rowId: string,
  dateKey: string,
  status: ActorAvailabilityStatus,
  comment?: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write") && !ctx.can("cast:write")) {
    return { error: "Недостаточно прав" };
  }

  const row = await prisma.actorAvailabilityRow.findFirst({
    where: { id: rowId, projectId },
  });
  if (!row) return { error: "Строка не найдена" };

  if (row.actorId) {
    const kpp = await buildKppActorBusyMap(projectId);
    if (kpp.get(dateKey)?.has(row.actorId)) {
      const parsedComment = comment?.trim().slice(0, 500) ?? "";
      const date = parseDateKey(dateKey);
      await prisma.actorAvailabilityDay.upsert({
        where: { rowId_date: { rowId, date } },
        create: {
          rowId,
          date,
          status: ActorAvailabilityStatus.BUSY_OUR_PROJECT,
          comment: parsedComment || null,
        },
        update: { comment: parsedComment || null },
      });
      revalidateAvailability(projectId);
      return { success: "Комментарий сохранён" };
    }
  }

  const parsedComment = comment?.trim().slice(0, 500) ?? "";
  const date = parseDateKey(dateKey);

  await prisma.actorAvailabilityDay.upsert({
    where: { rowId_date: { rowId, date } },
    create: {
      rowId,
      date,
      status,
      comment: parsedComment || null,
    },
    update: {
      status,
      comment: parsedComment || null,
    },
  });

  revalidateAvailability(projectId);
  return { success: "Сохранено" };
}

/** @deprecated используйте setAvailabilityDayAction */
export async function cycleAvailabilityDayAction(
  projectId: string,
  rowId: string,
  dateKey: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write") && !ctx.can("cast:write")) {
    return { error: "Недостаточно прав" };
  }

  const row = await prisma.actorAvailabilityRow.findFirst({
    where: { id: rowId, projectId },
    include: { days: true },
  });
  if (!row) return { error: "Строка не найдена" };

  const date = parseDateKey(dateKey);
  const existing = row.days.find(
    (d: { date: Date }) => d.date.toISOString().slice(0, 10) === dateKey,
  );

  if (row.actorId) {
    const kpp = await buildKppActorBusyMap(projectId);
    if (kpp.get(dateKey)?.has(row.actorId)) {
      return { error: "День занят по КПП — статус задаётся автоматически" };
    }
  }

  const current = existing?.status ?? ActorAvailabilityStatus.UNSET;
  const next = nextManualStatus(current);

  await prisma.actorAvailabilityDay.upsert({
    where: {
      rowId_date: { rowId, date },
    },
    create: { rowId, date, status: next },
    update: { status: next },
  });

  revalidateAvailability(projectId);
  return { success: "Статус обновлён" };
}

const commentSchema = z.object({
  comment: z.string().trim().max(500),
});

export async function updateAvailabilityDayCommentAction(
  projectId: string,
  rowId: string,
  dateKey: string,
  comment: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("schedule:write") && !ctx.can("cast:write")) {
    return { error: "Недостаточно прав" };
  }

  const parsed = commentSchema.safeParse({ comment });
  if (!parsed.success) return { error: "Слишком длинный комментарий" };

  const row = await prisma.actorAvailabilityRow.findFirst({
    where: { id: rowId, projectId },
  });
  if (!row) return { error: "Строка не найдена" };

  const date = parseDateKey(dateKey);
  const existing = await prisma.actorAvailabilityDay.findUnique({
    where: { rowId_date: { rowId, date } },
  });

  if (existing) {
    await prisma.actorAvailabilityDay.update({
      where: { id: existing.id },
      data: { comment: parsed.data.comment || null },
    });
  } else {
    await prisma.actorAvailabilityDay.create({
      data: {
        rowId,
        date,
        comment: parsed.data.comment || null,
      },
    });
  }

  revalidateAvailability(projectId);
  return { success: "Комментарий сохранён" };
}
