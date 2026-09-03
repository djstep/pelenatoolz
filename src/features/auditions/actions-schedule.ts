"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { parseDateKey } from "@/features/actor-availability/lib/status";
import { prisma } from "@/shared/db/prisma";

function revalidateSchedule(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/preproduction/auditions`);
  revalidatePath(`/ru/projects/${projectId}/preproduction/casting`);
}

const timeRegex = /^\d{2}:\d{2}$/;

export async function assignCandidateToScheduleSlotAction(
  projectId: string,
  payload: unknown,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const schema = z.object({
    castingCandidateId: z.string().min(1),
    date: z.string().min(1),
    time: z.string().regex(timeRegex),
    scheduleId: z.string().min(1).optional().nullable(),
  });
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { error: "Некорректные данные слота" };

  const date = parseDateKey(parsed.data.date);

  const candidate = await prisma.castingCandidate.findFirst({
    where: { id: parsed.data.castingCandidateId, projectId },
  });
  if (!candidate) return { error: "Кандидат не найден" };

  try {
    let scheduleId = parsed.data.scheduleId ?? null;

    if (scheduleId) {
      const existing = await prisma.auditionSchedule.findFirst({
        where: { id: scheduleId, projectId },
      });
      if (!existing) return { error: "Слот не найден" };
    } else {
      const sameSlot = await prisma.auditionSchedule.findFirst({
        where: { projectId, date, time: parsed.data.time },
      });
      if (sameSlot) {
        scheduleId = sameSlot.id;
      } else {
        const created = await prisma.auditionSchedule.create({
          data: {
            projectId,
            date,
            time: parsed.data.time,
          },
        });
        scheduleId = created.id;
      }
    }

    await prisma.auditionScheduleCandidate.upsert({
      where: {
        scheduleId_castingCandidateId: {
          scheduleId,
          castingCandidateId: parsed.data.castingCandidateId,
        },
      },
      create: {
        scheduleId,
        castingCandidateId: parsed.data.castingCandidateId,
      },
      update: {},
    });

    revalidateSchedule(projectId);
    return { success: "Кандидат добавлен в расписание", scheduleId };
  } catch (err) {
    console.error("[assignCandidateToSchedule]", err);
    return { error: "Не удалось запланировать" };
  }
}

export async function updateAuditionScheduleAction(
  projectId: string,
  scheduleId: string,
  payload: unknown,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const schema = z.object({
    date: z.string().min(1),
    time: z.string().regex(timeRegex),
    comment: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        const t = (v ?? "").trim();
        return t.length ? t.slice(0, 2000) : null;
      }),
    castingCandidateIds: z.array(z.string().min(1)).min(1),
  });
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { error: "Проверьте данные слота" };

  const date = parseDateKey(parsed.data.date);

  const schedule = await prisma.auditionSchedule.findFirst({
    where: { id: scheduleId, projectId },
  });
  if (!schedule) return { error: "Слот не найден" };

  const candidates = await prisma.castingCandidate.findMany({
    where: {
      projectId,
      id: { in: parsed.data.castingCandidateIds },
    },
    select: { id: true },
  });
  if (candidates.length !== parsed.data.castingCandidateIds.length) {
    return { error: "Один из кандидатов не найден" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.auditionSchedule.update({
        where: { id: scheduleId },
        data: {
          date,
          time: parsed.data.time,
          comment: parsed.data.comment,
        },
      });
      await tx.auditionScheduleCandidate.deleteMany({
        where: { scheduleId },
      });
      await tx.auditionScheduleCandidate.createMany({
        data: parsed.data.castingCandidateIds.map((castingCandidateId) => ({
          scheduleId,
          castingCandidateId,
        })),
      });
    });
    revalidateSchedule(projectId);
    return { success: "Слот обновлён" };
  } catch (err) {
    console.error("[updateAuditionSchedule]", err);
    return { error: "Не удалось обновить слот" };
  }
}

export async function removeCandidateFromScheduleAction(
  projectId: string,
  scheduleId: string,
  castingCandidateId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const schedule = await prisma.auditionSchedule.findFirst({
    where: { id: scheduleId, projectId },
    include: { candidates: true },
  });
  if (!schedule) return { error: "Слот не найден" };

  await prisma.auditionScheduleCandidate.deleteMany({
    where: { scheduleId, castingCandidateId },
  });

  const remaining = schedule.candidates.filter(
    (c) => c.castingCandidateId !== castingCandidateId,
  );
  if (remaining.length === 0) {
    await prisma.auditionSchedule.delete({ where: { id: scheduleId } });
  }

  revalidateSchedule(projectId);
  return { success: "Кандидат убран из слота" };
}

export async function deleteAuditionScheduleAction(
  projectId: string,
  scheduleId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const schedule = await prisma.auditionSchedule.findFirst({
    where: { id: scheduleId, projectId },
  });
  if (!schedule) return { error: "Слот не найден" };

  await prisma.auditionSchedule.delete({ where: { id: scheduleId } });
  revalidateSchedule(projectId);
  return { success: "Слот удалён" };
}

const breakPayloadSchema = z.object({
  date: z.string().min(1),
  time: z.string().regex(timeRegex),
  duration: z.string().regex(timeRegex),
  slotType: z.enum([
    "MAKEUP_COSTUME",
    "REHEARSAL",
    "SHOOTING",
    "LUNCH",
    "TRAVEL",
    "IDLE",
  ]),
  label: z.string().trim().min(1).max(120),
  notes: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      const t = (v ?? "").trim();
      return t.length ? t.slice(0, 2000) : null;
    }),
});

export async function placeAuditionScheduleBreakAction(
  projectId: string,
  payload: unknown,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const parsed = breakPayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: "Некорректные данные перерыва" };

  const date = parseDateKey(parsed.data.date);

  try {
    const created = await prisma.auditionScheduleBreak.create({
      data: {
        projectId,
        date,
        time: parsed.data.time,
        duration: parsed.data.duration,
        slotType: parsed.data.slotType,
        label: parsed.data.label,
        notes: parsed.data.notes,
      },
    });
    revalidateSchedule(projectId);
    return { success: "Перерыв добавлен", breakId: created.id };
  } catch (err) {
    console.error("[placeAuditionScheduleBreak]", err);
    return { error: "Не удалось добавить перерыв" };
  }
}

export async function updateAuditionScheduleBreakAction(
  projectId: string,
  breakId: string,
  payload: unknown,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const parsed = breakPayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: "Проверьте данные перерыва" };

  const existing = await prisma.auditionScheduleBreak.findFirst({
    where: { id: breakId, projectId },
  });
  if (!existing) return { error: "Перерыв не найден" };

  try {
    await prisma.auditionScheduleBreak.update({
      where: { id: breakId },
      data: {
        date: parseDateKey(parsed.data.date),
        time: parsed.data.time,
        duration: parsed.data.duration,
        slotType: parsed.data.slotType,
        label: parsed.data.label,
        notes: parsed.data.notes,
      },
    });
    revalidateSchedule(projectId);
    return { success: "Перерыв обновлён" };
  } catch (err) {
    console.error("[updateAuditionScheduleBreak]", err);
    return { error: "Не удалось обновить перерыв" };
  }
}

export async function deleteAuditionScheduleBreakAction(
  projectId: string,
  breakId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.auditionScheduleBreak.findFirst({
    where: { id: breakId, projectId },
  });
  if (!existing) return { error: "Перерыв не найден" };

  await prisma.auditionScheduleBreak.delete({ where: { id: breakId } });
  revalidateSchedule(projectId);
  return { success: "Перерыв удалён" };
}

export async function updateCastingCandidateRatingAction(
  projectId: string,
  castingCandidateId: string,
  rating: number | null,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:write")) return { error: "Недостаточно прав" };

  if (rating != null && (rating < 1 || rating > 5 || !Number.isInteger(rating))) {
    return { error: "Оценка должна быть от 1 до 5" };
  }

  const candidate = await prisma.castingCandidate.findFirst({
    where: { id: castingCandidateId, projectId },
  });
  if (!candidate) return { error: "Кандидат не найден" };

  await prisma.castingCandidate.update({
    where: { id: castingCandidateId },
    data: { rating },
  });
  revalidateSchedule(projectId);
  revalidatePath(`/ru/projects/${projectId}/preproduction/casting/${candidate.personId}`);
  return { success: "Оценка сохранена" };
}
