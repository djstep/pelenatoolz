import {
  toDateKey,
} from "@/features/actor-availability/lib/status";
import { auditionKindFromCount } from "@/features/auditions/lib/types";
import type {
  AuditionScheduleBreakRow,
  AuditionScheduleRow,
  ScheduleCandidateCard,
} from "@/features/auditions/lib/schedule-shared";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { prisma } from "@/shared/db/prisma";

export type {
  AuditionScheduleBreakRow,
  AuditionScheduleRow,
  ScheduleCandidateCard,
  SchedulePanelFilters,
} from "@/features/auditions/lib/schedule-shared";
export { SCHEDULE_TIME_SLOTS } from "@/features/auditions/lib/schedule-shared";

export async function listScheduleCandidates(
  projectId: string,
): Promise<ScheduleCandidateCard[]> {
  const [candidates, schedules, auditions] = await Promise.all([
    prisma.castingCandidate.findMany({
      where: { projectId },
      include: {
        person: {
          select: {
            id: true,
            photoUrl: true,
            lastName: true,
            firstName: true,
            middleName: true,
          },
        },
        character: {
          select: { id: true, name: true, roleType: true },
        },
      },
      orderBy: [
        { person: { lastName: "asc" } },
        { person: { firstName: "asc" } },
      ],
    }),
    prisma.auditionSchedule.findMany({
      where: { projectId },
      include: {
        candidates: { select: { castingCandidateId: true } },
      },
      orderBy: [{ date: "desc" }, { time: "asc" }],
    }),
    prisma.audition.findMany({
      where: { projectId },
      select: {
        id: true,
        date: true,
        actors: { select: { personId: true, characterId: true } },
      },
    }),
  ]);

  const nextCallByCandidate = new Map<
    string,
    { date: Date; time: string; scheduleId: string }
  >();
  const calledCandidateIds = new Set<string>();
  const todayKey = toDateKey(new Date());

  for (const s of schedules) {
    const dateKey = toDateKey(s.date);
    for (const link of s.candidates) {
      calledCandidateIds.add(link.castingCandidateId);
      if (dateKey < todayKey) continue;
      const prev = nextCallByCandidate.get(link.castingCandidateId);
      if (
        !prev ||
        s.date < prev.date ||
        (s.date.getTime() === prev.date.getTime() && s.time < prev.time)
      ) {
        nextCallByCandidate.set(link.castingCandidateId, {
          date: s.date,
          time: s.time,
          scheduleId: s.id,
        });
      }
    }
  }

  const hasTapeByCandidate = new Set<string>();
  for (const a of auditions) {
    for (const actor of a.actors) {
      for (const c of candidates) {
        if (
          c.personId === actor.personId &&
          (!actor.characterId || actor.characterId === c.characterId)
        ) {
          hasTapeByCandidate.add(c.id);
        }
      }
    }
  }

  return candidates.map((c) => {
    const next = nextCallByCandidate.get(c.id);
    return {
      id: c.id,
      rating: c.rating,
      status: c.status,
      person: {
        ...c.person,
        label: fullNameFromParts(c.person),
      },
      character: c.character,
      hasTape: hasTapeByCandidate.has(c.id),
      wasCalled: calledCandidateIds.has(c.id),
      nextCall: next
        ? {
            dateKey: toDateKey(next.date),
            time: next.time,
            scheduleId: next.scheduleId,
          }
        : null,
    };
  });
}

export async function listAuditionSchedules(
  projectId: string,
  opts?: { from?: Date; to?: Date },
): Promise<AuditionScheduleRow[]> {
  const rows = await prisma.auditionSchedule.findMany({
    where: {
      projectId,
      ...(opts?.from || opts?.to
        ? {
            date: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    include: {
      candidates: {
        include: {
          candidate: {
            include: {
              person: {
                select: {
                  id: true,
                  photoUrl: true,
                  lastName: true,
                  firstName: true,
                  middleName: true,
                },
              },
              character: {
                select: { id: true, name: true, roleType: true },
              },
            },
          },
        },
      },
    },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });

  return rows.map((row) => ({
    ...row,
    dateKey: toDateKey(row.date),
    kind: auditionKindFromCount(row.candidates.length),
    candidates: row.candidates.map((link) => ({
      linkId: link.id,
      castingCandidateId: link.castingCandidateId,
      rating: link.candidate.rating,
      person: {
        ...link.candidate.person,
        label: fullNameFromParts(link.candidate.person),
      },
      character: link.candidate.character,
    })),
  }));
}

export async function listAuditionScheduleBreaks(
  projectId: string,
  opts?: { from?: Date; to?: Date },
): Promise<AuditionScheduleBreakRow[]> {
  const rows = await prisma.auditionScheduleBreak.findMany({
    where: {
      projectId,
      ...(opts?.from || opts?.to
        ? {
            date: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });

  return rows.map((row) => ({
    ...row,
    dateKey: toDateKey(row.date),
  }));
}
