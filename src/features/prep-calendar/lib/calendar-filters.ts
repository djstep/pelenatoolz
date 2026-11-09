import type { CalendarParticipantKind } from "@/features/prep-calendar/lib/calendar-types";

/** Фильтры экрана и экспорта. Хранятся в адресе: `type`, `dept`, `person=вид:id`. */
export type CalendarFilters = {
  typeId: string | null;
  departmentId: string | null;
  person: { kind: CalendarParticipantKind; id: string } | null;
};

export const NO_FILTERS: CalendarFilters = { typeId: null, departmentId: null, person: null };

const KINDS: readonly CalendarParticipantKind[] = ["crew", "actor", "candidate"];
const ID = /^[\w-]{1,64}$/;

function idParam(value: unknown): string | null {
  return typeof value === "string" && ID.test(value) ? value : null;
}

/** Фильтры из адреса. Мусор отбрасывается молча: фильтр просто не применяется. */
export function parseCalendarFilters(query: Record<string, unknown>): CalendarFilters {
  let person: CalendarFilters["person"] = null;
  if (typeof query.person === "string") {
    const [kind, id] = query.person.split(":");
    const cleanId = idParam(id);
    if (KINDS.includes(kind as CalendarParticipantKind) && cleanId) {
      person = { kind: kind as CalendarParticipantKind, id: cleanId };
    }
  }
  return { typeId: idParam(query.type), departmentId: idParam(query.dept), person };
}

/** Обратно в параметры адреса: пустые фильтры не пишутся. */
export function filtersToQuery(filters: CalendarFilters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.typeId) query.type = filters.typeId;
  if (filters.departmentId) query.dept = filters.departmentId;
  if (filters.person) query.person = `${filters.person.kind}:${filters.person.id}`;
  return query;
}

export function hasFilters(filters: CalendarFilters): boolean {
  return Boolean(filters.typeId || filters.departmentId || filters.person);
}
