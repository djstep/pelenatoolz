import "server-only";

import type { Permission } from "@/features/memberships/permissions";
import { parseDateKey, toDateKey } from "@/features/actor-availability/lib/status";
import type {
  CalendarEvent,
  CalendarOptions,
  CalendarParticipant,
} from "@/features/prep-calendar/lib/calendar-types";
import type { CalendarFilters } from "@/features/prep-calendar/lib/calendar-filters";
import { addDaysToKey, type DateRange } from "@/features/prep-calendar/lib/calendar-view";
import { zonedDateTime, zonedTimeToUtc } from "@/features/prep-calendar/lib/zoned-time";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { prisma } from "@/shared/db/prisma";
import { LOCATION_PARENT_SELECT } from "@/features/locations/lib/location-fields";
import {
  compareLocations,
  formatLocationTitle,
  type LocationNameSource,
} from "@/features/locations/lib/format-location";

export type PrepEventTypeRow = {
  id: string;
  name: string;
  color: string;
  isHidden: boolean;
  /** Сколько событий этого типа: с событиями тип нельзя удалить, только скрыть. */
  eventCount: number;
};

/** Справочник типов проекта, по порядку. */
export async function listPrepEventTypes(projectId: string): Promise<PrepEventTypeRow[]> {
  const rows = await prisma.prepEventType.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      color: true,
      isHidden: true,
      _count: { select: { events: true } },
    },
  });
  return rows.map(({ _count, ...row }) => ({ ...row, eventCount: _count.events }));
}

/**
 * Что можно человеку в календаре. Имена команды и утверждённых актёров видят все с просмотром,
 * имена кандидатов — только с правом на кастинг. Выбирать людей и объект в окне события можно
 * только из тех списков, на которые есть право.
 */
export type CalendarRights = {
  canWrite: boolean;
  /** Имена кандидатов, выбор актёров и кандидатов. */
  canReadCast: boolean;
  /** Выбор людей команды. */
  canReadCrew: boolean;
  /** Выбор объекта из «Локаций». */
  canReadLocations: boolean;
  /** Подготовительные дни из КПП. */
  canReadSchedule: boolean;
};

export function calendarRights(can: (permission: Permission) => boolean): CalendarRights {
  return {
    canWrite: can("calendar:write"),
    canReadCast: can("cast:read"),
    canReadCrew: can("crew:read"),
    canReadLocations: can("script:read"),
    canReadSchedule: can("schedule:read"),
  };
}

export function locationLabel(location: LocationNameSource): string {
  return formatLocationTitle(location, " / ");
}

const nameSelect = { lastName: true, firstName: true, middleName: true } as const;

const eventSelect = {
  id: true,
  title: true,
  allDay: true,
  startDate: true,
  endDate: true,
  startAt: true,
  endAt: true,
  locationText: true,
  locationId: true,
  note: true,
  type: { select: { id: true, name: true, color: true } },
  location: { select: { name: true, sublocation: true, parent: LOCATION_PARENT_SELECT } },
  participants: {
    select: {
      crewMember: { select: { id: true, ...nameSelect } },
      actor: { select: { id: true, ...nameSelect } },
      castingPerson: { select: { id: true, ...nameSelect } },
    },
  },
  departments: {
    select: { department: { select: { id: true, name: true, sortOrder: true } } },
  },
} as const;

/** Моменты начала и конца видимых дней по поясу проекта: конец не включается. */
export function rangeInstants(range: DateRange, timezone: string) {
  return {
    fromAt: zonedTimeToUtc(range.from, "00:00", timezone),
    toAt: zonedTimeToUtc(addDaysToKey(range.to, 1), "00:00", timezone),
  };
}

/**
 * События видимых дней: одним запросом на весь диапазон. Многодневные и те, что начались
 * раньше, тоже попадают. Имена кандидатов без права на кастинг в ответ не попадают — только
 * их число.
 */
export async function listCalendarEvents(
  projectId: string,
  timezone: string,
  range: DateRange,
  rights: CalendarRights,
  filters: CalendarFilters,
): Promise<CalendarEvent[]> {
  const { fromAt, toAt } = rangeInstants(range, timezone);
  const person = filters.person;
  const personWhere = !person
    ? {}
    : person.kind === "crew"
      ? { crewMemberId: person.id }
      : person.kind === "actor"
        ? { actorId: person.id }
        : { castingPersonId: person.id };
  const rows = await prisma.prepEvent.findMany({
    where: {
      projectId,
      ...(filters.typeId ? { typeId: filters.typeId } : {}),
      ...(filters.departmentId ? { departments: { some: { departmentId: filters.departmentId } } } : {}),
      ...(person ? { participants: { some: personWhere } } : {}),
      OR: [
        {
          allDay: true,
          startDate: { lte: parseDateKey(range.to) },
          endDate: { gte: parseDateKey(range.from) },
        },
        { allDay: false, startAt: { lt: toAt }, endAt: { gte: fromAt } },
      ],
    },
    orderBy: [{ startDate: "asc" }, { startAt: "asc" }, { createdAt: "asc" }],
    select: eventSelect,
  });

  return rows.map((row) => {
    const start = row.startAt ? zonedDateTime(row.startAt, timezone) : null;
    const end = row.endAt ? zonedDateTime(row.endAt, timezone) : null;
    const participants: CalendarParticipant[] = [];
    let hiddenCandidates = 0;
    for (const link of row.participants) {
      if (link.crewMember) {
        participants.push({ kind: "crew", id: link.crewMember.id, label: fullNameFromParts(link.crewMember) });
      } else if (link.actor) {
        participants.push({ kind: "actor", id: link.actor.id, label: fullNameFromParts(link.actor) });
      } else if (link.castingPerson) {
        if (rights.canReadCast) {
          participants.push({
            kind: "candidate",
            id: link.castingPerson.id,
            label: fullNameFromParts(link.castingPerson),
          });
        } else {
          hiddenCandidates += 1;
        }
      }
    }
    participants.sort((a, b) => a.label.localeCompare(b.label, "ru"));

    return {
      id: row.id,
      title: row.title,
      type: row.type,
      allDay: row.allDay,
      startKey: start?.dateKey ?? toDateKey(row.startDate!),
      endKey: end?.dateKey ?? toDateKey(row.endDate!),
      startTime: start?.time ?? null,
      endTime: end?.time ?? null,
      locationText: row.locationText,
      locationId: row.locationId,
      locationName: row.location ? locationLabel(row.location) : null,
      note: row.note,
      participants,
      hiddenCandidates,
      departments: row.departments
        .map((link) => link.department)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ id, name }) => ({ id, name })),
    };
  });
}

/** Варианты для окна события. Только для тех, кто правит календарь. */
export async function listCalendarOptions(
  projectId: string,
  rights: CalendarRights,
): Promise<CalendarOptions> {
  const [types, crew, actors, candidates, locations, departments] = await Promise.all([
    prisma.prepEventType.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, color: true, isHidden: true },
    }),
    rights.canReadCrew
      ? prisma.crewMember.findMany({
          where: { projectId, archivedAt: null },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          select: { id: true, ...nameSelect, position: true },
        })
      : null,
    rights.canReadCast
      ? prisma.actor.findMany({
          where: { projectId },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          select: { id: true, ...nameSelect, character: { select: { name: true } } },
        })
      : null,
    rights.canReadCast
      ? prisma.castingPerson.findMany({
          // Утверждённый на роль — уже актёр: второй раз кандидатом его не предлагаем.
          where: { projectId, candidates: { none: { status: "APPROVED" } } },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          select: { id: true, ...nameSelect },
        })
      : null,
    rights.canReadLocations
      ? prisma.location
          .findMany({ where: { projectId }, select: { id: true, name: true, sublocation: true, sortOrder: true, parent: LOCATION_PARENT_SELECT } })
          .then((rows) => rows.sort(compareLocations))
      : null,
    prisma.department.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return {
    types,
    crew:
      crew?.map((person) => ({
        id: person.id,
        label: fullNameFromParts(person),
        hint: person.position ?? undefined,
      })) ?? null,
    actors:
      actors?.map((actor) => ({
        id: actor.id,
        label: fullNameFromParts(actor),
        hint: actor.character?.name ?? undefined,
      })) ?? null,
    candidates:
      candidates?.map((person) => ({ id: person.id, label: fullNameFromParts(person) })) ?? null,
    locations:
      locations?.map((location) => ({ id: location.id, label: locationLabel(location) })) ??
      null,
    departments,
  };
}

export type CalendarFilterOptions = {
  types: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  /** Люди, которые есть хоть в одном событии проекта. Кандидаты — только с правом на кастинг. */
  people: { value: string; label: string }[];
};

/** Варианты фильтров. Имена — те же, что видны в событиях: без контактов. */
export async function listCalendarFilterOptions(
  projectId: string,
  rights: CalendarRights,
): Promise<CalendarFilterOptions> {
  const [types, departments, links] = await Promise.all([
    prisma.prepEventType.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.prepEventParticipant.findMany({
      where: {
        event: { projectId },
        ...(rights.canReadCast ? {} : { castingPersonId: null }),
      },
      distinct: ["crewMemberId", "actorId", "castingPersonId"],
      select: {
        crewMember: { select: { id: true, ...nameSelect } },
        actor: { select: { id: true, ...nameSelect } },
        castingPerson: { select: { id: true, ...nameSelect } },
      },
    }),
  ]);

  const people = new Map<string, string>();
  for (const link of links) {
    if (link.crewMember) people.set(`crew:${link.crewMember.id}`, fullNameFromParts(link.crewMember));
    else if (link.actor) people.set(`actor:${link.actor.id}`, `${fullNameFromParts(link.actor)} (актёр)`);
    else if (link.castingPerson && rights.canReadCast) {
      people.set(`candidate:${link.castingPerson.id}`, `${fullNameFromParts(link.castingPerson)} (кандидат)`);
    }
  }
  return {
    types,
    departments,
    people: [...people]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru")),
  };
}

/**
 * Фильтр по человеку для проб: id людей кастинга. Кандидат — он сам, актёр — утверждённый на
 * его роль, человек команды на пробах не бывает. Без фильтра — null.
 */
export async function auditionPersonIds(
  projectId: string,
  person: CalendarFilters["person"],
): Promise<string[] | null> {
  if (!person) return null;
  if (person.kind === "candidate") return [person.id];
  if (person.kind === "crew") return [];
  const actor = await prisma.actor.findFirst({
    where: { id: person.id, projectId },
    select: {
      character: {
        select: { castingCandidates: { where: { status: "APPROVED" }, select: { personId: true } } },
      },
    },
  });
  return actor?.character?.castingCandidates.map((c) => c.personId) ?? [];
}
