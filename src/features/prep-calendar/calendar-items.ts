import "server-only";

import type { Permission } from "@/features/memberships/permissions";
import {
  hasFilters,
  type CalendarFilters,
} from "@/features/prep-calendar/lib/calendar-filters";
import type { CalendarItem, PulledSources } from "@/features/prep-calendar/lib/calendar-types";
import type { DateRange } from "@/features/prep-calendar/lib/calendar-view";
import { listPulledItems } from "@/features/prep-calendar/pulled-queries";
import {
  auditionPersonIds,
  calendarRights,
  listCalendarEvents,
  type CalendarRights,
} from "@/features/prep-calendar/queries";

type Query = Record<string, string | string[] | undefined>;

/** Переключатели источников из адреса: без права — null, выключенный — «0». */
export function pulledSourcesFromQuery(rights: CalendarRights, query: Query): PulledSources {
  return {
    auditions: rights.canReadCast ? query.auditions !== "0" : null,
    kpp: rights.canReadSchedule ? query.kpp !== "0" : null,
  };
}

/** Фильтр по кандидату без права на кастинг не применяется: имён кандидатов такой человек не видит. */
export function allowedFilters(rights: CalendarRights, filters: CalendarFilters): CalendarFilters {
  if (filters.person?.kind === "candidate" && !rights.canReadCast) return { ...filters, person: null };
  return filters;
}

/**
 * Свои события и подтянутые записи на диапазон: для экрана и для выгрузки, с одними правами и
 * фильтрами. Фильтр по типу и цеху оставляет только свои события: у проб и дней КПП их нет.
 */
export async function loadCalendarItems(input: {
  projectId: string;
  timezone: string;
  range: DateRange;
  can: (permission: Permission) => boolean;
  filters: CalendarFilters;
  sources: PulledSources;
  projectPath: string;
}): Promise<CalendarItem[]> {
  const rights = calendarRights(input.can);
  const filters = allowedFilters(rights, input.filters);
  const onlyOwn = Boolean(filters.typeId || filters.departmentId);
  const personIds = hasFilters(filters) ? await auditionPersonIds(input.projectId, filters.person) : null;

  const [events, pulled] = await Promise.all([
    listCalendarEvents(input.projectId, input.timezone, input.range, rights, filters),
    onlyOwn
      ? []
      : listPulledItems(
          input.projectId,
          input.timezone,
          input.range,
          {
            auditions: input.sources.auditions === true,
            kpp: input.sources.kpp === true,
            personIds,
          },
          input.projectPath,
        ),
  ]);
  return [...events, ...pulled];
}
