"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  buildCallSheetCopies,
  canEditCallSheets,
  checkCallSheetCommand,
  checkTemplateSave,
  DAY_NOT_FOUND,
  parseTemplatePayload,
  templateAuditView,
  type CallSheetCopies,
  type CallSheetTemplateData,
  type InProjectCheck,
} from "@/features/call-sheets/lib/template-rules";
import {
  getCallSheetTemplate,
  loadTemplateForCopy,
  type Tx,
} from "@/features/call-sheets/queries";
import { memberLabelsById } from "@/features/departments/queries";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { isWorkingShootDay } from "@/features/schedule/lib/shoot-day-type";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type CallSheetTemplateActionState = { error?: string; success?: string };

const ALREADY_EXISTS = "Вызывной этого дня уже создан";
const NOT_CREATED = "Вызывной этого дня ещё не создан";
const NOT_WORKING_DAY = "Вызывной создаётся только для рабочего съёмочного дня";

function inProjectCheck(projectId: string): InProjectCheck {
  return async (entity, ids) => {
    try {
      await assertInProject(entity, ids, projectId);
      return true;
    } catch (error) {
      if (isNotInProjectError(error)) return false;
      throw error;
    }
  };
}

function isUniqueError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

async function auditNames(projectId: string, datas: CallSheetTemplateData[]) {
  const memberIds = datas.flatMap((d) =>
    d.leaders.map((row) => row.membershipId).filter((id): id is string => id !== null),
  );
  const departmentIds = datas.flatMap((d) =>
    d.crewCalls.map((row) => row.departmentId).filter((id): id is string => id !== null),
  );
  const [members, departments] = await Promise.all([
    memberLabelsById(projectId, [...new Set(memberIds)]),
    departmentIds.length === 0
      ? Promise.resolve([])
      : prisma.department.findMany({
          where: { projectId, id: { in: [...new Set(departmentIds)] } },
          select: { id: true, name: true },
        }),
  ]);
  return { members, departments: new Map(departments.map((d) => [d.id, d.name])) };
}

export async function saveCallSheetTemplateAction(
  projectId: string,
  _prev: CallSheetTemplateActionState,
  formData: FormData,
): Promise<CallSheetTemplateActionState> {
  const ctx = await requireProjectContext(projectId);
  const checked = await checkTemplateSave(
    { canEdit: canEditCallSheets(ctx), inProject: inProjectCheck(projectId) },
    formData.get("payload") ?? "",
  );
  if ("error" in checked) return { error: checked.error };
  const { data } = checked;

  const beforeParsed = parseTemplatePayload(await getCallSheetTemplate(projectId));
  const before = "data" in beforeParsed ? beforeParsed.data : null;
  if (before && JSON.stringify(before) === JSON.stringify(data)) {
    return { success: "Шаблон сохранён" };
  }

  const names = await auditNames(projectId, before ? [before, data] : [data]);

  await auditMutation(
    ctx,
    async (next: CallSheetTemplateData) => {
      // Шаблон сохраняется целиком: на строки шаблона ничего не ссылается.
      await prisma.$transaction(async (tx) => {
        await tx.callSheetTemplateLeader.deleteMany({ where: { projectId } });
        await tx.callSheetTemplateCrewCall.deleteMany({ where: { projectId } });
        await tx.callSheetTemplateBaseItem.deleteMany({ where: { projectId } });
        await tx.callSheetTemplateLeader.createMany({
          data: next.leaders.map((row, index) => ({ ...row, projectId, sortOrder: index })),
        });
        await tx.callSheetTemplateCrewCall.createMany({
          data: next.crewCalls.map((row, index) => ({ ...row, projectId, sortOrder: index })),
        });
        await tx.callSheetTemplateBaseItem.createMany({
          data: next.baseItems.map((row, index) => ({ ...row, projectId, sortOrder: index })),
        });
      });
    },
    data,
    {
      projectId,
      entityType: AuditEntityType.callSheetTemplate,
      entityId: projectId,
      action: "UPDATE",
      summary: "Изменён шаблон вызывного",
      // Телефоны в журнал не пишем.
      changes: {
        ...(before ? { from: templateAuditView(before, names) } : {}),
        to: templateAuditView(data, names),
      },
    },
  );

  revalidatePath(`/ru/projects/${projectId}/settings/call-sheet-template`);
  return { success: "Шаблон сохранён" };
}

function copiesCount(copies: CallSheetCopies) {
  return {
    leaders: copies.leaders.length,
    crewCalls: copies.crewCalls.length,
    baseItems: copies.baseItems.length,
  };
}

async function writeCopies(
  tx: Pick<Tx, "callSheetLeader" | "callSheetCrewCall" | "callSheetBaseItem">,
  callSheetId: string,
  copies: CallSheetCopies,
) {
  await tx.callSheetLeader.createMany({
    data: copies.leaders.map((row) => ({ ...row, callSheetId })),
  });
  await tx.callSheetCrewCall.createMany({
    data: copies.crewCalls.map((row) => ({ ...row, callSheetId })),
  });
  await tx.callSheetBaseItem.createMany({
    data: copies.baseItems.map((row) => ({ ...row, callSheetId })),
  });
}

function revalidateDay(projectId: string, dayId: string) {
  revalidatePath(`/ru/projects/${projectId}/call-sheets/${dayId}`);
  revalidatePath(`/ru/projects/${projectId}/call-sheets`);
}

/** «Создать вызывной»: новый вызывной дня с копией шаблона проекта. */
export async function createCallSheetAction(
  projectId: string,
  dayId: string,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  const checked = await checkCallSheetCommand(
    { canEdit: canEditCallSheets(ctx), inProject: inProjectCheck(projectId) },
    dayId,
  );
  if ("error" in checked) return { error: checked.error };

  const day = await prisma.shootDay.findFirst({
    where: { id: checked.dayId, projectId },
    select: { dayNumber: true, dayType: true, callSheet: { select: { id: true } } },
  });
  if (!day) return { error: DAY_NOT_FOUND };
  if (!isWorkingShootDay(day.dayType)) return { error: NOT_WORKING_DAY };
  if (day.callSheet) return { error: ALREADY_EXISTS };

  try {
    await auditMutation(
      ctx,
      (shootDayId: string) =>
        prisma.$transaction(async (tx) => {
          const copies = buildCallSheetCopies(await loadTemplateForCopy(tx, projectId));
          const sheet = await tx.callSheet.create({
            data: { projectId, shootDayId },
            select: { id: true },
          });
          await writeCopies(tx, sheet.id, copies);
          return { id: sheet.id, copies };
        }),
      checked.dayId,
      {
        projectId,
        entityType: AuditEntityType.callSheet,
        action: "CREATE",
        entityId: (_input, result) => result.id,
        summary: `Создан вызывной дня ${day.dayNumber}`,
        changes: (_input, result) => ({ fromTemplate: copiesCount(result.copies) }),
      },
    );
  } catch (error) {
    // Два окна нажали одновременно — второй получает понятный ответ.
    if (isUniqueError(error)) return { error: ALREADY_EXISTS };
    throw error;
  }

  revalidateDay(projectId, checked.dayId);
  return {};
}

/** «Обновить из шаблона»: руководители, цеха и база вызывного заменяются копией шаблона. */
export async function refreshCallSheetFromTemplateAction(
  projectId: string,
  dayId: string,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  const checked = await checkCallSheetCommand(
    { canEdit: canEditCallSheets(ctx), inProject: inProjectCheck(projectId) },
    dayId,
  );
  if ("error" in checked) return { error: checked.error };

  const sheet = await prisma.callSheet.findFirst({
    where: { projectId, shootDayId: checked.dayId },
    select: {
      id: true,
      shootDay: { select: { dayNumber: true } },
      _count: { select: { leaders: true, crewCalls: true, baseItems: true } },
    },
  });
  if (!sheet) return { error: NOT_CREATED };

  await auditMutation(
    ctx,
    (callSheetId: string) =>
      prisma.$transaction(async (tx) => {
        const copies = buildCallSheetCopies(await loadTemplateForCopy(tx, projectId));
        await tx.callSheetLeader.deleteMany({ where: { callSheetId } });
        await tx.callSheetCrewCall.deleteMany({ where: { callSheetId } });
        await tx.callSheetBaseItem.deleteMany({ where: { callSheetId } });
        await writeCopies(tx, callSheetId, copies);
        await tx.callSheet.update({
          where: { id: callSheetId },
          data: { templateAppliedAt: new Date() },
        });
        return copies;
      }),
    sheet.id,
    {
      projectId,
      entityType: AuditEntityType.callSheet,
      action: "UPDATE",
      entityId: sheet.id,
      summary: `Вызывной дня ${sheet.shootDay.dayNumber} обновлён из шаблона`,
      changes: (_input, copies) => ({
        from: {
          leaders: sheet._count.leaders,
          crewCalls: sheet._count.crewCalls,
          baseItems: sheet._count.baseItems,
        },
        to: copiesCount(copies),
      }),
    },
  );

  revalidateDay(projectId, checked.dayId);
  return {};
}
