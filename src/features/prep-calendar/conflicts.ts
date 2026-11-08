import "server-only";

import { parseDateKey, toDateKey } from "@/features/actor-availability/lib/status";
import type { PulledSource } from "@/features/prep-calendar/lib/calendar-types";
import { eventDateTimeLabel } from "@/features/prep-calendar/lib/calendar-format";
import { addDaysToKey } from "@/features/prep-calendar/lib/calendar-view";
import type { PrepEventRange } from "@/features/prep-calendar/lib/event-dates";
import { daysOverlap, timesOverlap } from "@/features/prep-calendar/lib/overlap";
import {
  AUDITION_SLOT_MINUTES,
  normalizeSourceTime,
  plusMinutes,
} from "@/features/prep-calendar/lib/pulled-time";
import { zonedDateTime, zonedTimeToUtc } from "@/features/prep-calendar/lib/zoned-time";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { prisma } from "@/shared/db/prisma";

/** Строка предупреждения: что за событие, когда и кто из участников в нём тоже занят. */
export type CalendarConflict = {
  key: string;
  source: "event" | PulledSource;
  title: string;
  when: string;
  people: string[];
};

/** Не больше стольких строк в предупреждении: длинный список всё равно не прочитают. */
const MAX_CONFLICTS = 20;

const nameSelect = { lastName: true, firstName: true, middleName: true } as const;

type Input = {
  projectId: string;
  timezone: string;
  /** Правим событие — с самим собой оно не пересекается. */
  eventId: string | null;
  range: PrepEventRange;
  crewIds: string[];
  actorIds: string[];
  candidateIds: string[];
  /** Без права на кастинг пробы не проверяются, а кандидаты не называются по имени. */
  canReadCast: boolean;
};

function dayKeys(range: PrepEventRange, timezone: string): { from: string; to: string } {
  if (range.allDay) return { from: range.startDate, to: range.endDate };
  return {
    from: zonedDateTime(range.startAt, timezone).dateKey,
    to: zonedDateTime(range.endAt, timezone).dateKey,
  };
}

/** Свои события с теми же людьми в то же время. */
async function eventConflicts(input: Input): Promise<CalendarConflict[]> {
  const { projectId, timezone, eventId, range, crewIds, actorIds, candidateIds } = input;
  const people = [
    ...(crewIds.length > 0 ? [{ crewMemberId: { in: crewIds } }] : []),
    ...(actorIds.length > 0 ? [{ actorId: { in: actorIds } }] : []),
    ...(candidateIds.length > 0 ? [{ castingPersonId: { in: candidateIds } }] : []),
  ];
  if (people.length === 0) return [];

  const when = range.allDay
    ? {
        allDay: true,
        startDate: { lte: parseDateKey(range.endDate) },
        endDate: { gte: parseDateKey(range.startDate) },
      }
    : { allDay: false, startAt: { lt: range.endAt }, endAt: { gt: range.startAt } };

  const rows = await prisma.prepEvent.findMany({
    where: {
      projectId,
      ...(eventId ? { id: { not: eventId } } : {}),
      ...when,
      participants: { some: { OR: people } },
    },
    orderBy: [{ startDate: "asc" }, { startAt: "asc" }],
    take: MAX_CONFLICTS,
    select: {
      id: true,
      title: true,
      allDay: true,
      startDate: true,
      endDate: true,
      startAt: true,
      endAt: true,
      participants: {
        where: { OR: people },
        select: {
          crewMember: { select: nameSelect },
          actor: { select: nameSelect },
          castingPerson: { select: nameSelect },
        },
      },
    },
  });

  return rows
    .filter((row) =>
      // База уже отобрала; для времени ещё раз — встык не пересечение.
      range.allDay || timesOverlap(row.startAt!, row.endAt!, range.startAt, range.endAt),
    )
    .map((row) => {
      const start = row.startAt ? zonedDateTime(row.startAt, timezone) : null;
      const end = row.endAt ? zonedDateTime(row.endAt, timezone) : null;
      return {
        key: `event:${row.id}`,
        source: "event" as const,
        title: row.title,
        when: eventDateTimeLabel({
          allDay: row.allDay,
          startKey: start?.dateKey ?? toDateKey(row.startDate!),
          endKey: end?.dateKey ?? toDateKey(row.endDate!),
          startTime: start?.time ?? null,
          endTime: end?.time ?? null,
        }),
        people: row.participants.map((link) => {
          if (link.crewMember) return fullNameFromParts(link.crewMember);
          if (link.actor) return fullNameFromParts(link.actor);
          return input.canReadCast && link.castingPerson
            ? fullNameFromParts(link.castingPerson)
            : "кандидат";
        }),
      };
    });
}

/**
 * Пробы тех же людей. Кандидат — сам человек кастинга; актёр — человек, утверждённый на его
 * роль (прямой связи актёра с кастингом в базе нет).
 */
async function auditionConflicts(input: Input): Promise<CalendarConflict[]> {
  const { projectId, timezone, range, actorIds, candidateIds } = input;
  const approved =
    actorIds.length > 0
      ? await prisma.actor.findMany({
          where: { projectId, id: { in: actorIds }, characterId: { not: null } },
          select: {
            character: {
              select: {
                castingCandidates: {
                  where: { status: "APPROVED" },
                  select: { personId: true },
                },
              },
            },
          },
        })
      : [];
  const personIds = [
    ...new Set([
      ...candidateIds,
      ...approved.flatMap((actor) => actor.character?.castingCandidates.map((c) => c.personId) ?? []),
    ]),
  ];
  if (personIds.length === 0) return [];

  const days = dayKeys(range, timezone);
  const dateWhere = {
    gte: parseDateKey(addDaysToKey(days.from, -1)),
    lte: parseDateKey(addDaysToKey(days.to, 1)),
  };
  const [plans, tapes] = await Promise.all([
    prisma.auditionSchedule.findMany({
      where: { projectId, date: dateWhere, candidates: { some: { candidate: { personId: { in: personIds } } } } },
      select: {
        id: true,
        date: true,
        time: true,
        candidates: {
          where: { candidate: { personId: { in: personIds } } },
          select: { candidate: { select: { person: { select: nameSelect } } } },
        },
      },
    }),
    prisma.audition.findMany({
      where: { projectId, isSelfTape: false, date: dateWhere, actors: { some: { personId: { in: personIds } } } },
      select: {
        id: true,
        date: true,
        time: true,
        actors: { where: { personId: { in: personIds } }, select: { person: { select: nameSelect } } },
      },
    }),
  ]);

  const result: CalendarConflict[] = [];
  const check = (
    source: PulledSource,
    id: string,
    title: string,
    date: Date,
    rawTime: string | null,
    people: string[],
  ) => {
    const dateKey = toDateKey(date);
    const time = normalizeSourceTime(rawTime);
    if (!time) {
      // Проба без времени — как «весь день»: только с событием на весь день.
      if (!range.allDay || !daysOverlap(dateKey, dateKey, range.startDate, range.endDate)) return;
      result.push({ key: `${source}:${id}`, source, title, when: eventDateTimeLabel({ allDay: true, startKey: dateKey, endKey: dateKey, startTime: null, endTime: null }), people });
      return;
    }
    if (range.allDay) return;
    const end = plusMinutes(dateKey, time, AUDITION_SLOT_MINUTES);
    const startAt = zonedTimeToUtc(dateKey, time, timezone);
    const endAt = zonedTimeToUtc(end.endKey, end.endTime, timezone);
    if (!timesOverlap(startAt, endAt, range.startAt, range.endAt)) return;
    result.push({
      key: `${source}:${id}`,
      source,
      title,
      when: eventDateTimeLabel({ allDay: false, startKey: dateKey, endKey: end.endKey, startTime: time, endTime: end.endTime }),
      people,
    });
  };

  for (const plan of plans) {
    check("auditionPlan", plan.id, "План проб", plan.date, plan.time, plan.candidates.map(({ candidate }) => fullNameFromParts(candidate.person)));
  }
  for (const tape of tapes) {
    check("auditionTape", tape.id, "Запись пробы", tape.date, tape.time, tape.actors.map(({ person }) => fullNameFromParts(person)));
  }
  return result;
}

/**
 * Кто из участников события занят в то же время: в своих событиях или на пробах. Пробы — только
 * тому, кто видит кастинг. Сохранять не мешает: это предупреждение.
 */
export async function findPrepEventConflicts(input: Input): Promise<CalendarConflict[]> {
  const [events, auditions] = await Promise.all([
    eventConflicts(input),
    input.canReadCast ? auditionConflicts(input) : [],
  ]);
  return [...events, ...auditions].slice(0, MAX_CONFLICTS);
}
