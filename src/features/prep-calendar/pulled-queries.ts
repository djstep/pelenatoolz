import "server-only";

import { parseDateKey, toDateKey } from "@/features/actor-availability/lib/status";
import type { PulledItem } from "@/features/prep-calendar/lib/calendar-types";
import { addDaysToKey, type DateRange } from "@/features/prep-calendar/lib/calendar-view";
import {
  AUDITION_SLOT_MINUTES,
  normalizeSourceTime,
  plusMinutes,
} from "@/features/prep-calendar/lib/pulled-time";
import { zonedDateTime } from "@/features/prep-calendar/lib/zoned-time";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { prisma } from "@/shared/db/prisma";

/** Какие источники грузить: только с правом на источник и включённым переключателем. */
export type PulledRequest = {
  auditions: boolean;
  kpp: boolean;
  /** Фильтр по человеку: id людей кастинга. null — без фильтра, пустой список — ничего. */
  personIds: string[] | null;
};

const nameSelect = { lastName: true, firstName: true, middleName: true } as const;

function personLabel(person: { lastName: string; firstName: string | null; middleName: string | null }, role?: string | null) {
  const name = fullNameFromParts(person);
  return role ? `${name} (${role})` : name;
}

function timed(dateKey: string, rawTime: string | null) {
  const startTime = normalizeSourceTime(rawTime);
  if (!startTime) {
    return { allDay: true, startKey: dateKey, endKey: dateKey, startTime: null, endTime: null };
  }
  return { allDay: false, startKey: dateKey, startTime, ...plusMinutes(dateKey, startTime, AUDITION_SLOT_MINUTES) };
}

/** План проб: слоты планировщика кастинга. Своей страницы у слота нет — ведём на «Пробы». */
async function auditionPlan(
  projectId: string,
  range: DateRange,
  projectPath: string,
  personIds: string[] | null,
): Promise<PulledItem[]> {
  const rows = await prisma.auditionSchedule.findMany({
    where: {
      projectId,
      date: { gte: parseDateKey(range.from), lte: parseDateKey(range.to) },
      ...(personIds ? { candidates: { some: { candidate: { personId: { in: personIds } } } } } : {}),
    },
    orderBy: [{ date: "asc" }, { time: "asc" }],
    select: {
      id: true,
      date: true,
      time: true,
      comment: true,
      candidates: {
        select: {
          candidate: { select: { person: { select: nameSelect }, character: { select: { name: true } } } },
        },
      },
    },
  });
  return rows.map((row) => {
    const people = row.candidates.map(({ candidate }) =>
      personLabel(candidate.person, candidate.character.name),
    );
    const names = row.candidates.map(({ candidate }) => fullNameFromParts(candidate.person));
    return {
      pulled: true,
      id: `auditionPlan:${row.id}`,
      source: "auditionPlan",
      title: names.length > 0 ? `Пробы: ${names.join(", ")}` : "Пробы",
      href: `${projectPath}/preproduction/auditions`,
      ...timed(toDateKey(row.date), row.time),
      people,
      note: row.comment,
    };
  });
}

/** Записи проб с датой. Самопробы не показываем: это не встреча в определённое время. */
async function auditionTapes(
  projectId: string,
  range: DateRange,
  projectPath: string,
  personIds: string[] | null,
): Promise<PulledItem[]> {
  const rows = await prisma.audition.findMany({
    where: {
      projectId,
      isSelfTape: false,
      ...(personIds ? { actors: { some: { personId: { in: personIds } } } } : {}),
      date: { gte: parseDateKey(range.from), lte: parseDateKey(range.to) },
    },
    orderBy: [{ date: "asc" }, { time: "asc" }],
    select: {
      id: true,
      date: true,
      time: true,
      comment: true,
      actors: { select: { person: { select: nameSelect }, character: { select: { name: true } } } },
    },
  });
  return rows.map((row) => {
    const people = row.actors.map((actor) => personLabel(actor.person, actor.character?.name));
    const names = row.actors.map((actor) => fullNameFromParts(actor.person));
    return {
      pulled: true,
      id: `auditionTape:${row.id}`,
      source: "auditionTape",
      title: names.length > 0 ? `Запись пробы: ${names.join(", ")}` : "Запись пробы",
      href: `${projectPath}/preproduction/auditions/${row.id}`,
      ...timed(toDateKey(row.date), row.time),
      people,
      note: row.comment,
    };
  });
}

/**
 * Подготовительные дни КПП. Дата дня — момент полуночи: на сервере это полночь UTC, у старых
 * записей с компьютера — полночь по Москве. Поэтому берём день по поясу проекта, а запрос
 * расширяем на сутки в обе стороны.
 */
async function kppPrepDays(
  projectId: string,
  timezone: string,
  range: DateRange,
  projectPath: string,
): Promise<PulledItem[]> {
  const rows = await prisma.shootDay.findMany({
    where: {
      projectId,
      dayType: "PREP",
      date: {
        gte: parseDateKey(addDaysToKey(range.from, -1)),
        lt: parseDateKey(addDaysToKey(range.to, 2)),
      },
    },
    orderBy: [{ date: "asc" }, { dayNumber: "asc" }],
    select: { id: true, date: true, dayNumber: true, prepNote: true },
  });
  return rows.flatMap((row) => {
    const dateKey = zonedDateTime(row.date, timezone).dateKey;
    if (dateKey < range.from || dateKey > range.to) return [];
    return [
      {
        pulled: true as const,
        id: `kppPrep:${row.id}`,
        source: "kppPrep" as const,
        title: `День ${row.dayNumber}${row.prepNote ? `: ${row.prepNote}` : ""}`,
        href: `${projectPath}/schedule`,
        allDay: true,
        startKey: dateKey,
        endKey: dateKey,
        startTime: null,
        endTime: null,
        people: [],
        note: row.prepNote,
      },
    ];
  });
}

/**
 * Записи из кастинга и КПП на видимые дни: по одному запросу на источник, без копирования в
 * таблицу событий. Источник без права не запрашивается вовсе.
 */
export async function listPulledItems(
  projectId: string,
  timezone: string,
  range: DateRange,
  request: PulledRequest,
  projectPath: string,
): Promise<PulledItem[]> {
  const [plan, tapes, kpp] = await Promise.all([
    request.auditions ? auditionPlan(projectId, range, projectPath, request.personIds) : [],
    request.auditions ? auditionTapes(projectId, range, projectPath, request.personIds) : [],
    // У дня КПП нет людей: при фильтре по человеку его не показываем.
    request.kpp && !request.personIds ? kppPrepDays(projectId, timezone, range, projectPath) : [],
  ]);
  return [...plan, ...tapes, ...kpp];
}
