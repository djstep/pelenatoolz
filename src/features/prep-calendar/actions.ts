"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prepEventTypeFormSchema } from "@/features/prep-calendar/schemas";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

/** Что ввёл человек — вернуть в окно при ошибке. */
export type PrepEventTypeFormValues = { name: string; color: string };

export type PrepEventTypeActionState = {
  error?: string;
  success?: string;
  values?: PrepEventTypeFormValues;
};

const NO_RIGHTS = "Недостаточно прав";
const NOT_FOUND = "Тип события не найден";
const DUPLICATE_ERROR = "Тип с таким названием уже есть";
const HAS_EVENTS_ERROR = "У типа есть события: его можно только скрыть";
const LAST_VISIBLE_ERROR = "Должен остаться хотя бы один видимый тип";

// Проект в действиях — только `ctx.project.id`: аргумент приходит из браузера и может быть не строкой.
function revalidateEventTypes(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/settings/event-types`);
}

function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function parseForm(formData: FormData) {
  // Нет поля в запросе — та же понятная ошибка, что и для пустого.
  return prepEventTypeFormSchema.safeParse({
    name: formData.get("name") ?? "",
    color: formData.get("color") ?? "",
  });
}

function formValues(formData: FormData): PrepEventTypeFormValues {
  return {
    name: String(formData.get("name") ?? "").slice(0, 100),
    color: String(formData.get("color") ?? "").slice(0, 20),
  };
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Некорректные данные";
}

/** Без видимых типов новое событие создать нельзя: скрывать и удалять последний нельзя. */
async function isLastVisibleType(projectId: string, typeId: string): Promise<boolean> {
  const others = await prisma.prepEventType.count({
    where: { projectId, isHidden: false, id: { not: typeId } },
  });
  return others === 0;
}

export async function createPrepEventTypeAction(
  rawProjectId: string,
  _prev: PrepEventTypeActionState,
  formData: FormData,
): Promise<PrepEventTypeActionState> {
  const ctx = await requireProjectContext(rawProjectId);
  if (!ctx.can("calendar:write")) return { error: NO_RIGHTS };
  const projectId = ctx.project.id;

  const parsed = parseForm(formData);
  if (!parsed.success) return { error: firstIssue(parsed.error), values: formValues(formData) };
  const { name, color } = parsed.data;

  const last = await prisma.prepEventType.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  try {
    await auditMutation(
      ctx,
      () =>
        prisma.prepEventType.create({
          data: { projectId, name, color, sortOrder: (last._max.sortOrder ?? -1) + 1 },
          select: { id: true },
        }),
      null,
      {
        projectId,
        entityType: AuditEntityType.prepEventType,
        action: "CREATE",
        entityId: (_, row) => row.id,
        summary: `Добавлен тип события: ${name}`,
      },
    );
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      return { error: DUPLICATE_ERROR, values: formValues(formData) };
    }
    throw error;
  }

  revalidateEventTypes(projectId);
  return { success: "Тип события добавлен" };
}

export async function updatePrepEventTypeAction(
  rawProjectId: string,
  typeId: string,
  _prev: PrepEventTypeActionState,
  formData: FormData,
): Promise<PrepEventTypeActionState> {
  const ctx = await requireProjectContext(rawProjectId);
  if (!ctx.can("calendar:write")) return { error: NO_RIGHTS };
  const projectId = ctx.project.id;
  if (typeof typeId !== "string") return { error: NOT_FOUND };

  const parsed = parseForm(formData);
  if (!parsed.success) return { error: firstIssue(parsed.error), values: formValues(formData) };
  const { name, color } = parsed.data;

  const before = await prisma.prepEventType.findFirst({
    where: { id: typeId, projectId },
    select: { name: true, color: true },
  });
  if (!before) return { error: NOT_FOUND };

  try {
    await auditMutation(
      ctx,
      () => prisma.prepEventType.update({ where: { id: typeId, projectId }, data: { name, color } }),
      null,
      {
        projectId,
        entityType: AuditEntityType.prepEventType,
        action: "UPDATE",
        entityId: typeId,
        summary: `Изменён тип события: ${name}`,
        changes: {
          ...(before.name !== name ? { Название: { from: before.name, to: name } } : {}),
          ...(before.color !== color ? { Цвет: { from: before.color, to: color } } : {}),
        },
      },
    );
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      return { error: DUPLICATE_ERROR, values: formValues(formData) };
    }
    if (isPrismaError(error, "P2025")) return { error: NOT_FOUND };
    throw error;
  }

  revalidateEventTypes(projectId);
  return { success: "Тип события сохранён" };
}

/** Скрытый тип не предлагается в новых событиях; старые события остаются с ним. */
export async function setPrepEventTypeHiddenAction(
  rawProjectId: string,
  typeId: string,
  hidden: boolean,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(rawProjectId);
  if (!ctx.can("calendar:write")) return { error: NO_RIGHTS };
  const projectId = ctx.project.id;
  if (typeof typeId !== "string") return { error: NOT_FOUND };

  const type = await prisma.prepEventType.findFirst({
    where: { id: typeId, projectId },
    select: { name: true },
  });
  if (!type) return { error: NOT_FOUND };
  if (hidden === true && (await isLastVisibleType(projectId, typeId))) {
    return { error: LAST_VISIBLE_ERROR };
  }

  try {
    await auditMutation(
      ctx,
      () =>
        prisma.prepEventType.update({
          where: { id: typeId, projectId },
          data: { isHidden: hidden === true },
        }),
      null,
      {
        projectId,
        entityType: AuditEntityType.prepEventType,
        action: "UPDATE",
        entityId: typeId,
        summary: `${hidden === true ? "Скрыт" : "Возвращён"} тип события: ${type.name}`,
      },
    );
  } catch (error) {
    if (isPrismaError(error, "P2025")) return { error: NOT_FOUND };
    throw error;
  }

  revalidateEventTypes(projectId);
  return {};
}

/** Удаляется только тип без событий. Гонку с новым событием ловит внешний ключ. */
export async function deletePrepEventTypeAction(
  rawProjectId: string,
  typeId: string,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(rawProjectId);
  if (!ctx.can("calendar:write")) return { error: NO_RIGHTS };
  const projectId = ctx.project.id;
  if (typeof typeId !== "string") return { error: NOT_FOUND };

  const type = await prisma.prepEventType.findFirst({
    where: { id: typeId, projectId },
    select: { name: true, isHidden: true, _count: { select: { events: true } } },
  });
  if (!type) return { error: NOT_FOUND };
  if (type._count.events > 0) return { error: HAS_EVENTS_ERROR };
  if (!type.isHidden && (await isLastVisibleType(projectId, typeId))) {
    return { error: LAST_VISIBLE_ERROR };
  }

  try {
    await auditMutation(
      ctx,
      () => prisma.prepEventType.delete({ where: { id: typeId, projectId } }),
      null,
      {
        projectId,
        entityType: AuditEntityType.prepEventType,
        action: "DELETE",
        entityId: typeId,
        summary: `Удалён тип события: ${type.name}`,
      },
    );
  } catch (error) {
    if (isPrismaError(error, "P2003")) return { error: HAS_EVENTS_ERROR };
    if (isPrismaError(error, "P2025")) return { error: NOT_FOUND };
    throw error;
  }

  revalidateEventTypes(projectId);
  return {};
}
