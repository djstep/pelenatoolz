"use client";

import { useRouter } from "next/navigation";
import type { CalendarFilterOptions } from "@/features/prep-calendar/queries";
import {
  filtersToQuery,
  hasFilters,
  parseCalendarFilters,
  type CalendarFilters,
} from "@/features/prep-calendar/lib/calendar-filters";
import type { PulledSources } from "@/features/prep-calendar/lib/calendar-types";
import { calendarHref, type CalendarView } from "@/features/prep-calendar/lib/calendar-view";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";

/**
 * Фильтры и переключатели источников. Всё хранится в адресе: смена — переход на новый адрес,
 * сервер отдаёт уже отобранное.
 */
export function CalendarFiltersBar({
  basePath,
  view,
  date,
  filters,
  options,
  sources,
}: {
  basePath: string;
  view: CalendarView;
  date: string;
  filters: CalendarFilters;
  options: CalendarFilterOptions;
  sources: PulledSources;
}) {
  const router = useRouter();

  function go(nextFilters: CalendarFilters, nextSources: PulledSources) {
    const query = filtersToQuery(nextFilters);
    if (nextSources.auditions === false) query.auditions = "0";
    if (nextSources.kpp === false) query.kpp = "0";
    router.push(calendarHref(basePath, view, date, query));
  }

  const toggles = (
    [
      ["auditions", "Пробы"],
      ["kpp", "Подготовительные дни КПП"],
    ] as const
  ).filter(([key]) => sources[key] !== null);

  const personValue = filters.person ? `${filters.person.kind}:${filters.person.id}` : "";

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[repeat(3,minmax(0,14rem))_auto] sm:items-end">
        <div>
          <Label htmlFor="calendar-filter-type">Тип</Label>
          <Select
            id="calendar-filter-type"
            value={filters.typeId ?? ""}
            onChange={(change) => go({ ...filters, typeId: change.target.value || null }, sources)}
          >
            <option value="">Все типы</option>
            {options.types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="calendar-filter-dept">Цех</Label>
          <Select
            id="calendar-filter-dept"
            value={filters.departmentId ?? ""}
            onChange={(change) =>
              go({ ...filters, departmentId: change.target.value || null }, sources)
            }
          >
            <option value="">Все цеха</option>
            {options.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="calendar-filter-person">Человек</Label>
          <Select
            id="calendar-filter-person"
            value={personValue}
            onChange={(change) =>
              go(
                { ...filters, person: parseCalendarFilters({ person: change.target.value }).person },
                sources,
              )
            }
          >
            <option value="">Все люди</option>
            {options.people.map((person) => (
              <option key={person.value} value={person.value}>
                {person.label}
              </option>
            ))}
          </Select>
        </div>
        {hasFilters(filters) ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => go({ typeId: null, departmentId: null, person: null }, sources)}
          >
            Сбросить фильтры
          </Button>
        ) : null}
      </div>

      {toggles.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs font-semibold text-[var(--muted-fg)]">Показывать:</span>
          {toggles.map(([key, label]) => (
            <Checkbox
              key={key}
              label={label}
              checked={sources[key] === true}
              onChange={(change) => go(filters, { ...sources, [key]: change.target.checked })}
            />
          ))}
          {filters.typeId || filters.departmentId ? (
            <span className="text-xs text-[var(--muted-fg)]">
              При фильтре по типу или цеху видны только свои события.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
