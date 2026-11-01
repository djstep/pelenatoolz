"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  loadElementsAutoSource,
  loadSectionsWithCounts,
  savedElementSelect,
} from "@/features/call-sheets/elements-queries";
import {
  checkElementsSave,
  checkSectionsSave,
  DAY_NOT_FOUND,
  elementCounts,
  planElementsSave,
  planSectionsSave,
  resolveSectionIds,
  sameElementRows,
  SHEET_NOT_CREATED,
  type ElementsInProjectCheck,
  type ElementWrite,
  type SectionsPayload,
} from "@/features/call-sheets/lib/elements-rules";
import { buildAutoRows } from "@/features/call-sheets/lib/sections";
import { canEditCallSheets } from "@/features/call-sheets/lib/template-rules";
import { ensureCallSheetSections } from "@/features/call-sheets/sections-db";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type CallSheetElementsActionState = { error?: string; success?: string };

const CHANGED_ELSEWHERE = "Данные изменили в другом окне — обновите страницу";

/** Отказ внутри транзакции: откатить запись и вернуть текст пользователю. */
class SaveRefused extends Error {}

function inProjectCheck(projectId: string): ElementsInProjectCheck {
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

/** «Сохранить разделы» на экране «Шаблон вызывного». */
export async function saveCallSheetSectionsAction(
  projectId: string,
  _prev: CallSheetElementsActionState,
  formData: FormData,
): Promise<CallSheetElementsActionState> {
  const ctx = await requireProjectContext(projectId);
  const checked = await checkSectionsSave(
    { canEdit: canEditCallSheets(ctx), inProject: inProjectCheck(projectId) },
    formData.get("payload") ?? "",
  );
  if ("error" in checked) return { error: checked.error };

  const planned = planSectionsSave(await loadSectionsWithCounts(prisma, projectId), checked.data);
  if ("error" in planned) return { error: planned.error };
  if (!planned.changed) return { success: "Разделы сохранены" };

  try {
    await auditMutation(
      ctx,
      (data: SectionsPayload) =>
        prisma.$transaction(async (tx) => {
          await ensureCallSheetSections(tx, projectId);
          // План — заново по данным внутри транзакции (системные разделы уже в базе).
          const plan = planSectionsSave(await loadSectionsWithCounts(tx, projectId), data);
          if ("error" in plan) throw new SaveRefused(plan.error);
          if (plan.deletes.length > 0) {
            // Строки вызывных в этих разделах удаляются каскадом.
            await tx.callSheetSection.deleteMany({
              where: { projectId, key: null, id: { in: plan.deletes.map((d) => d.id) } },
            });
          }
          for (const row of plan.updates) {
            await tx.callSheetSection.updateMany({
              where: { id: row.id, projectId },
              data: { name: row.name, sortOrder: row.sortOrder },
            });
          }
          if (plan.creates.length > 0) {
            await tx.callSheetSection.createMany({
              data: plan.creates.map((row) => ({ ...row, projectId })),
            });
          }
          return plan;
        }),
      checked.data,
      {
        projectId,
        entityType: AuditEntityType.callSheetTemplate,
        entityId: projectId,
        action: "UPDATE",
        summary: "Изменены разделы элементов площадки",
        changes: (_input, plan) => plan.audit,
      },
    );
  } catch (error) {
    if (error instanceof SaveRefused) return { error: error.message };
    if (isUniqueError(error)) return { error: CHANGED_ELSEWHERE };
    throw error;
  }

  revalidatePath(`/ru/projects/${projectId}/settings/call-sheet-template`);
  revalidatePath("/[locale]/projects/[projectId]/call-sheets/[dayId]", "page");
  return { success: "Разделы сохранены" };
}

/** «Сохранить элементы площадки» в вызывном дня. */
export async function saveCallSheetElementsAction(
  projectId: string,
  dayId: string,
  _prev: CallSheetElementsActionState,
  formData: FormData,
): Promise<CallSheetElementsActionState> {
  const ctx = await requireProjectContext(projectId);
  const checked = await checkElementsSave(
    { canEdit: canEditCallSheets(ctx), inProject: inProjectCheck(projectId) },
    dayId,
    formData.get("payload") ?? "",
  );
  if ("error" in checked) return { error: checked.error };

  const sheet = await prisma.callSheet.findFirst({
    where: { projectId, shootDayId: checked.dayId },
    select: {
      id: true,
      shootDay: { select: { dayNumber: true } },
      elements: { select: savedElementSelect },
    },
  });
  if (!sheet) return { error: SHEET_NOT_CREATED };

  const [source, sections] = await Promise.all([
    loadElementsAutoSource(prisma, projectId, checked.dayId),
    prisma.callSheetSection.findMany({ where: { projectId }, select: { id: true, key: true } }),
  ]);
  if (!source) return { error: DAY_NOT_FOUND };

  const planned = planElementsSave({
    autoRows: buildAutoRows(source.scenes, source.shiftResources),
    saved: sheet.elements,
    sections,
    data: checked.data,
  });
  if ("error" in planned) return { error: planned.error };

  const resolvedNow = resolveSectionIds(planned.rows, sections);
  if ("rows" in resolvedNow && sameElementRows(sheet.elements, resolvedNow.rows)) {
    return { success: "Элементы площадки сохранены" };
  }

  const callSheetId = sheet.id;
  try {
    await auditMutation(
      ctx,
      (rows: ElementWrite[]) =>
        prisma.$transaction(async (tx) => {
          await ensureCallSheetSections(tx, projectId);
          const fresh = await tx.callSheetSection.findMany({
            where: { projectId },
            select: { id: true, key: true },
          });
          const resolved = resolveSectionIds(rows, fresh);
          if ("error" in resolved) throw new SaveRefused(resolved.error);
          // На строки элементов ничего не ссылается — сохраняем целиком.
          await tx.callSheetElement.deleteMany({ where: { callSheetId } });
          await tx.callSheetElement.createMany({
            data: resolved.rows.map((row) => ({ ...row, callSheetId })),
          });
        }),
      planned.rows,
      {
        projectId,
        entityType: AuditEntityType.callSheet,
        entityId: callSheetId,
        action: "UPDATE",
        summary: `Изменены элементы площадки вызывного дня ${sheet.shootDay.dayNumber}`,
        changes: {
          from: elementCounts(sheet.elements),
          to: elementCounts(planned.rows),
        },
      },
    );
  } catch (error) {
    if (error instanceof SaveRefused) return { error: error.message };
    if (isUniqueError(error)) return { error: CHANGED_ELSEWHERE };
    throw error;
  }

  revalidatePath(`/ru/projects/${projectId}/call-sheets/${checked.dayId}`);
  return { success: "Элементы площадки сохранены" };
}
