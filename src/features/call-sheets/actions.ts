"use server";

import { MembershipStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  buildSheetRows,
  changedMemberIds,
  checkSheetSave,
  sheetAuditView,
  type StoredLeader,
} from "@/features/call-sheets/lib/sheet-rules";
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
import {
  isCallSheetEditRefused,
  parseExpectedRevision,
  REVISION_FIELD,
} from "@/features/call-sheets/lib/revision";
import { withCallSheetRevision } from "@/features/call-sheets/revision-db";
import { ensureCallSheetSections } from "@/features/call-sheets/sections-db";
import { memberLabelsById } from "@/features/departments/queries";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { isWorkingShootDay } from "@/features/schedule/lib/shoot-day-type";
import { syncShootDayResourceUsages } from "@/features/schedule/lib/sync-shoot-day-resources";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type CallSheetTemplateActionState = {
  error?: string;
  success?: string;
  /** Номер правки вызывного после сохранения — браузер шлёт его со следующим. */
  revision?: number | null;
};

/** Ответ команд вызывного; `revision` — новый номер правки. */
export type CallSheetCommandResult = { error?: string; revision?: number | null };

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
): Promise<CallSheetCommandResult> {
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
          // Разделы элементов площадки проекта: системные — если их ещё нет.
          await ensureCallSheetSections(tx, projectId);
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
  return { revision: 0 };
}

/** «Обновить из шаблона»: руководители, цеха и база вызывного заменяются копией шаблона. */
export async function refreshCallSheetFromTemplateAction(
  projectId: string,
  dayId: string,
  revision: unknown,
): Promise<CallSheetCommandResult> {
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

  let saved;
  try {
    saved = await auditMutation(
      ctx,
      (callSheetId: string) =>
        withCallSheetRevision(
          projectId,
          checked.dayId,
          parseExpectedRevision(revision),
          async (tx) => {
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
          },
        ),
      sheet.id,
      {
        projectId,
        entityType: AuditEntityType.callSheet,
        action: "UPDATE",
        entityId: sheet.id,
        summary: `Вызывной дня ${sheet.shootDay.dayNumber} обновлён из шаблона`,
        changes: (_input, { result: copies }) => ({
          from: {
            leaders: sheet._count.leaders,
            crewCalls: sheet._count.crewCalls,
            baseItems: sheet._count.baseItems,
          },
          to: copiesCount(copies),
        }),
      },
    );
  } catch (error) {
    if (isCallSheetEditRefused(error)) return { error: error.message };
    throw error;
  }

  revalidateDay(projectId, checked.dayId);
  return { revision: saved.revision };
}

/** Руководители, цеха, база и поля листа — как они в вызывном сейчас (для журнала). */
type StoredSheet = {
  id: string;
  tempDay: string | null;
  tempNight: string | null;
  importantNote: string | null;
  actorRestrictions: string | null;
  schemeLocationId: string | null;
  shootDay: { dayNumber: number };
  leaders: (StoredLeader & { position: string; shortTitle: string | null; sortOrder: number })[];
  crewCalls: CallSheetCopies["crewCalls"];
  baseItems: CallSheetCopies["baseItems"];
};

/** Правка самого вызывного: блоки из шаблона (добавить, убрать, поменять, порядок) и поля листа. */
export async function saveCallSheetSheetAction(
  projectId: string,
  dayId: string,
  _prev: CallSheetTemplateActionState,
  formData: FormData,
): Promise<CallSheetTemplateActionState> {
  const ctx = await requireProjectContext(projectId);
  const deps = { canEdit: canEditCallSheets(ctx), inProject: inProjectCheck(projectId) };
  const command = await checkCallSheetCommand(deps, dayId);
  if ("error" in command) return { error: command.error };
  const expected = parseExpectedRevision(formData.get(REVISION_FIELD));

  const sheet: StoredSheet | null = await prisma.callSheet.findFirst({
    where: { projectId, shootDayId: command.dayId },
    select: {
      id: true,
      tempDay: true,
      tempNight: true,
      importantNote: true,
      actorRestrictions: true,
      schemeLocationId: true,
      shootDay: { select: { dayNumber: true } },
      leaders: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          position: true,
          shortTitle: true,
          membershipId: true,
          personName: true,
          phone: true,
          sortOrder: true,
        },
      },
      crewCalls: {
        orderBy: { sortOrder: "asc" },
        select: { departmentId: true, label: true, callTime: true, sortOrder: true },
      },
      baseItems: {
        orderBy: { sortOrder: "asc" },
        select: { name: true, callTime: true, notNeeded: true, sortOrder: true },
      },
    },
  });
  if (!sheet) return { error: NOT_CREATED };

  const checked = await checkSheetSave(deps, formData.get("payload") ?? "", sheet.leaders);
  if ("error" in checked) return { error: checked.error };
  const { data } = checked;

  const memberIds = changedMemberIds(data.leaders, sheet.leaders);
  const departmentIds = data.crewCalls
    .map((row) => row.departmentId)
    .filter((id): id is string => id !== null);
  const [members, departments] = await Promise.all([
    memberIds.length === 0
      ? Promise.resolve([])
      : prisma.projectMembership.findMany({
          where: { projectId, id: { in: memberIds }, status: MembershipStatus.ACTIVE },
          select: { id: true, user: { select: { name: true, phone: true } } },
        }),
    departmentIds.length === 0
      ? Promise.resolve([])
      : prisma.department.findMany({
          where: { projectId, id: { in: departmentIds } },
          select: { id: true, name: true },
        }),
  ]);
  const rows = buildSheetRows(
    data,
    sheet.leaders,
    new Map(members.map((m) => [m.id, { name: m.user.name, phone: m.user.phone }])),
    new Map(departments.map((d) => [d.id, d.name])),
  );

  const before = sheetAuditView(sheet, {
    leaders: sheet.leaders,
    crewCalls: sheet.crewCalls,
    baseItems: sheet.baseItems,
  });
  const after = sheetAuditView(data, rows);
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return { success: "Вызывной сохранён" };
  }

  let saved;
  try {
    saved = await auditMutation(
      ctx,
      (callSheetId: string) =>
        withCallSheetRevision(projectId, command.dayId, expected, async (tx) => {
          await tx.callSheet.update({
            where: { id: callSheetId },
            data: {
              tempDay: data.tempDay,
              tempNight: data.tempNight,
              importantNote: data.importantNote,
              actorRestrictions: data.actorRestrictions,
              schemeLocationId: data.schemeLocationId,
            },
          });
          // Копии шаблона в вызывном: на их строки ничего не ссылается.
          await tx.callSheetLeader.deleteMany({ where: { callSheetId } });
          await tx.callSheetCrewCall.deleteMany({ where: { callSheetId } });
          await tx.callSheetBaseItem.deleteMany({ where: { callSheetId } });
          await writeCopies(tx, callSheetId, rows);
        }),
      sheet.id,
      {
        projectId,
        entityType: AuditEntityType.callSheet,
        action: "UPDATE",
        entityId: sheet.id,
        summary: `Изменён вызывной дня ${sheet.shootDay.dayNumber}`,
        // Телефоны в журнал не пишем.
        changes: { from: before, to: after },
      },
    );
  } catch (error) {
    if (isCallSheetEditRefused(error)) return { error: error.message };
    throw error;
  }

  revalidateDay(projectId, command.dayId);
  return { success: "Вызывной сохранён", revision: saved.revision };
}

/**
 * «Обновить из КПП»: ресурсы смены дня заново из сцен дня (раньше это делало открытие
 * страницы). Посменные ресурсы, добавленные руками, остаются.
 */
export async function refreshCallSheetFromScheduleAction(
  projectId: string,
  dayId: string,
  revision: unknown,
): Promise<CallSheetCommandResult> {
  const ctx = await requireProjectContext(projectId);
  const checked = await checkCallSheetCommand(
    { canEdit: canEditCallSheets(ctx), inProject: inProjectCheck(projectId) },
    dayId,
  );
  if ("error" in checked) return { error: checked.error };

  const day = await prisma.shootDay.findFirst({
    where: { id: checked.dayId, projectId },
    select: { dayNumber: true, dayType: true },
  });
  if (!day) return { error: DAY_NOT_FOUND };
  if (!isWorkingShootDay(day.dayType)) return { error: NOT_WORKING_DAY };

  const before = await prisma.shootDayResourceUsage.count({
    where: { shootDayId: checked.dayId },
  });

  let saved;
  try {
    saved = await auditMutation(
      ctx,
      (shootDayId: string) =>
        withCallSheetRevision(
          projectId,
          shootDayId,
          parseExpectedRevision(revision),
          async (tx) => {
            await syncShootDayResourceUsages(shootDayId, tx);
            return tx.shootDayResourceUsage.count({ where: { shootDayId } });
          },
        ),
      checked.dayId,
      {
        projectId,
        entityType: AuditEntityType.callSheet,
        action: "UPDATE",
        entityId: checked.dayId,
        summary: `Вызывной дня ${day.dayNumber} обновлён из КПП`,
        changes: (_input, { result: after }) => ({
          resourceUsages: { from: before, to: after },
        }),
      },
    );
  } catch (error) {
    if (isCallSheetEditRefused(error)) return { error: error.message };
    throw error;
  }

  revalidateDay(projectId, checked.dayId);
  return { revision: saved.revision };
}
