"use server";

import { revalidatePath } from "next/cache";
import { findPrepEventConflicts, type CalendarConflict } from "@/features/prep-calendar/conflicts";
import { toDateKey } from "@/features/actor-availability/lib/status";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import {
  prepEventRangeColumns,
  prepEventRangeError,
  type PrepEventRange,
} from "@/features/prep-calendar/lib/event-dates";
import { zonedDateTime, zonedTimeToUtc } from "@/features/prep-calendar/lib/zoned-time";
import { calendarRights, locationLabel } from "@/features/prep-calendar/queries";
import { prepEventInputSchema, type PrepEventInput } from "@/features/prep-calendar/schemas";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type PrepEventActionResult = {
  error?: string;
  success?: string;
  eventId?: string;
  /** Не сохранено: участники заняты в это время. Повтор с `confirmOverlaps` сохранит. */
  conflicts?: CalendarConflict[];
};

const NO_RIGHTS = "Недостаточно прав";
const NOT_FOUND = "Событие не найдено — обновите страницу";
const FOREIGN = "Тип, человек, цех или объект не найден в проекте — обновите страницу";
const HIDDEN_TYPE = "Этот тип скрыт — выберите другой";
const ARCHIVED_CREW = "Человек в архиве команды — его нельзя добавить в событие";

// Проект в действиях — только `ctx.project.id`: аргумент приходит из браузера и может быть не строкой.
function revalidateCalendar(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/preproduction/calendar`);
}

function toRange(data: PrepEventInput, timezone: string): PrepEventRange {
  if (data.allDay) {
    return { allDay: true, startDate: data.startDate, endDate: data.endDate };
  }
  return {
    allDay: false,
    startAt: zonedTimeToUtc(data.startDate, data.startTime!, timezone),
    endAt: zonedTimeToUtc(data.endDate, data.endTime!, timezone),
  };
}

/** «2026-11-10 10:00 – 2026-11-10 11:00» или «2026-11-10 – 2026-11-12, весь день». */
function whenText(
  row: {
    allDay: boolean;
    startDate: Date | null;
    endDate: Date | null;
    startAt: Date | null;
    endAt: Date | null;
  },
  timezone: string,
): string {
  if (row.allDay) return `${toDateKey(row.startDate!)} – ${toDateKey(row.endDate!)}, весь день`;
  const start = zonedDateTime(row.startAt!, timezone);
  const end = zonedDateTime(row.endAt!, timezone);
  return `${start.dateKey} ${start.time} – ${end.dateKey} ${end.time}`;
}

/** Событие исчезло между проверкой и удалением. */
class EventGoneError extends Error {}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Проверьте поля события";
}

/** Журнал: без имён людей. Его читают все с просмотром календаря, а кандидаты — не всем. */
function auditChanges(
  before: Record<string, string | number | null> | null,
  after: Record<string, string | number | null>,
) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, value] of Object.entries(after)) {
    const previous = before ? before[field] ?? null : null;
    if (previous !== value) changes[field] = { from: previous, to: value };
  }
  return changes;
}

/**
 * Создать или изменить событие. Людей и объект можно менять только из списков, на которые есть
 * право: остальное остаётся как было, даже если браузер прислал другое.
 */
export async function savePrepEventAction(
  rawProjectId: string,
  rawEventId: string | null,
  input: unknown,
): Promise<PrepEventActionResult> {
  const ctx = await requireProjectContext(rawProjectId);
  const rights = calendarRights(ctx.can);
  if (!rights.canWrite) return { error: NO_RIGHTS };
  const projectId = ctx.project.id;
  const timezone = ctx.project.timezone;
  if (rawEventId !== null && typeof rawEventId !== "string") return { error: NOT_FOUND };

  const parsed = prepEventInputSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const data = parsed.data;

  const range = toRange(data, timezone);
  const rangeError = prepEventRangeError(range);
  if (rangeError) return { error: rangeError };

  const existing = rawEventId
    ? await prisma.prepEvent.findFirst({
        where: { id: rawEventId, projectId },
        select: {
          id: true,
          title: true,
          typeId: true,
          allDay: true,
          startDate: true,
          endDate: true,
          startAt: true,
          endAt: true,
          locationId: true,
          locationText: true,
          type: { select: { name: true } },
          location: { select: { name: true, sublocation: true } },
          participants: { select: { crewMemberId: true, actorId: true, castingPersonId: true } },
          departments: { select: { departmentId: true } },
        },
      })
    : null;
  if (rawEventId && !existing) return { error: NOT_FOUND };

  const before = (key: "crewMemberId" | "actorId" | "castingPersonId") =>
    (existing?.participants ?? []).flatMap((link) => (link[key] ? [link[key]] : []));
  const crewIds = rights.canReadCrew ? data.crewMemberIds : before("crewMemberId");
  const actorIds = rights.canReadCast ? data.actorIds : before("actorId");
  const candidateIds = rights.canReadCast ? data.castingPersonIds : before("castingPersonId");
  const locationId = rights.canReadLocations ? data.locationId : (existing?.locationId ?? null);

  try {
    await assertInProject("PrepEventType", data.typeId, projectId);
    await assertInProject("CrewMember", crewIds, projectId);
    await assertInProject("Actor", actorIds, projectId);
    await assertInProject("CastingPerson", candidateIds, projectId);
    await assertInProject("Department", data.departmentIds, projectId);
    if (locationId) await assertInProject("Location", locationId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: FOREIGN };
    throw error;
  }

  const type = await prisma.prepEventType.findFirst({
    where: { id: data.typeId, projectId },
    select: { name: true, isHidden: true },
  });
  if (!type) return { error: FOREIGN };
  if (type.isHidden && existing?.typeId !== data.typeId) return { error: HIDDEN_TYPE };

  // Кто уже был в событии, остаётся и после ухода в архив; нового из архива не добавить.
  const added = crewIds.filter((id) => !before("crewMemberId").includes(id));
  if (added.length > 0) {
    const archived = await prisma.crewMember.count({
      where: { id: { in: added }, projectId, archivedAt: { not: null } },
    });
    if (archived > 0) return { error: ARCHIVED_CREW };
  }

  const location = locationId
    ? await prisma.location.findFirst({
        where: { id: locationId, projectId },
        select: { name: true, sublocation: true },
      })
    : null;

  const fields = {
    title: data.title,
    typeId: data.typeId,
    ...prepEventRangeColumns(range),
    locationId,
    locationText: data.locationText,
    note: data.note,
  };
  const participants = [
    ...crewIds.map((crewMemberId) => ({ crewMemberId })),
    ...actorIds.map((actorId) => ({ actorId })),
    ...candidateIds.map((castingPersonId) => ({ castingPersonId })),
  ];
  const departments = data.departmentIds.map((departmentId) => ({ departmentId }));

  // Предупреждение, а не запрет: после «Сохранить всё равно» проверка не повторяется.
  if (!data.confirmOverlaps && participants.length > 0) {
    const conflicts = await findPrepEventConflicts({
      projectId,
      timezone,
      eventId: existing?.id ?? null,
      range,
      crewIds,
      actorIds,
      // Без права на кастинг кандидаты в проверку не идут: иначе предупреждение выдало бы,
      // что тот же скрытый кандидат занят в другом событии.
      candidateIds: rights.canReadCast ? candidateIds : [],
      canReadCast: rights.canReadCast,
    });
    if (conflicts.length > 0) return { conflicts };
  }

  const summaryOf = (row: {
    title: string;
    typeName: string;
    when: string;
    place: string | null;
    people: number;
    departments: number;
  }) => ({
    Название: row.title,
    Тип: row.typeName,
    Когда: row.when,
    Место: row.place,
    Участников: row.people,
    Цехов: row.departments,
  });
  const afterSummary = summaryOf({
    title: data.title,
    typeName: type.name,
    when: whenText(fields, timezone),
    place: [location ? locationLabel(location) : null, data.locationText].filter(Boolean).join(", ") || null,
    people: participants.length,
    departments: departments.length,
  });
  const beforeSummary = existing
    ? summaryOf({
        title: existing.title,
        typeName: existing.type.name,
        when: whenText(existing, timezone),
        place:
          [existing.location ? locationLabel(existing.location) : null, existing.locationText]
            .filter(Boolean)
            .join(", ") || null,
        people: existing.participants.length,
        departments: existing.departments.length,
      })
    : null;

  const saved = await prisma.$transaction((tx) =>
    auditMutation(
      ctx,
      async () => {
        if (existing) {
          await tx.prepEvent.update({
            where: { id: existing.id, projectId },
            data: {
              ...fields,
              participants: { deleteMany: {}, create: participants },
              departments: { deleteMany: {}, create: departments },
            },
          });
          return { id: existing.id };
        }
        return tx.prepEvent.create({
          data: {
            ...fields,
            projectId,
            createdById: ctx.user.id!,
            participants: { create: participants },
            departments: { create: departments },
          },
          select: { id: true },
        });
      },
      null,
      {
        projectId,
        entityType: AuditEntityType.prepEvent,
        action: existing ? "UPDATE" : "CREATE",
        entityId: (_, row) => row.id,
        summary: `${existing ? "Изменено" : "Добавлено"} событие календаря: ${data.title}`,
        changes: auditChanges(beforeSummary, afterSummary),
      },
      { db: tx },
    ),
  );

  revalidateCalendar(projectId);
  return { success: existing ? "Событие сохранено" : "Событие добавлено", eventId: saved.id };
}

export async function deletePrepEventAction(
  rawProjectId: string,
  eventId: string,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(rawProjectId);
  if (!ctx.can("calendar:write")) return { error: NO_RIGHTS };
  const projectId = ctx.project.id;
  if (typeof eventId !== "string") return { error: NOT_FOUND };

  const event = await prisma.prepEvent.findFirst({
    where: { id: eventId, projectId },
    select: { title: true },
  });
  if (!event) return { error: NOT_FOUND };

  // Удалили параллельно — откатываем транзакцию, чтобы в журнале не было удаления, которого не было.
  const deleted = await prisma
    .$transaction((tx) =>
      auditMutation(
        ctx,
        async () => {
          const result = await tx.prepEvent.deleteMany({ where: { id: eventId, projectId } });
          if (result.count === 0) throw new EventGoneError();
          return result;
        },
      null,
      {
        projectId,
        entityType: AuditEntityType.prepEvent,
        action: "DELETE",
        entityId: eventId,
          summary: `Удалено событие календаря: ${event.title}`,
        },
        { db: tx },
      ),
    )
    .catch((error: unknown) => {
      if (error instanceof EventGoneError) return null;
      throw error;
    });
  if (!deleted) return { error: NOT_FOUND };

  revalidateCalendar(projectId);
  return {};
}
