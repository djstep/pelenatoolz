"use server";

import { revalidatePath } from "next/cache";
import { canEditCallSheets } from "@/features/call-sheets/lib/template-rules";
import {
  canEditTransportFinance,
  canSeeTransportKmRate,
  checkTransportSave,
  toEditorRow,
  transportAuditChanges,
  type DayInProjectCheck,
  type TransportEditorRow,
  type TransportSavePlan,
} from "@/features/day-docs/lib/transport-rules";
import { loadDayTransports } from "@/features/day-docs/transport-queries";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { checkBudgetItemsUsable } from "@/features/smeta/budget-item-access";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type TransportSaveState = {
  error?: string;
  success?: string;
  /** Строки после сохранения (с id новых строк) — редактор берёт их вместо своих */
  rows?: TransportEditorRow[];
};

const CHANGED_ELSEWHERE = "Спецтранспорт изменили в другом окне — обновите страницу";
const SAVED = "Спецтранспорт сохранён";

/** Строку изменили или удалили, пока шло сохранение: транзакция откатывается. */
class TransportChangedError extends Error {}

function inProjectCheck(projectId: string): DayInProjectCheck {
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

function isEmptyPlan(plan: TransportSavePlan) {
  return plan.create.length === 0 && plan.update.length === 0 && plan.remove.length === 0;
}

/**
 * «Сохранить спецтранспорт» в вызывном: по id строк (обновить / создать / удалить), без
 * пересоздания — строки отчёта смены и введённые км остаются. Право — «КПП и вызывные:
 * правка»; поставить или сменить статью сметы и ставку км — ещё и «Финансы: правка».
 * Payload — поле формы `payload`: `{ rows: [{ id?, name, callTime, wrapTime, scenes, notes,
 * kmRate?, budgetItemId? }] }`, порядок строк — порядок в массиве.
 */
export async function saveCallSheetTransportsAction(
  projectId: string,
  dayId: string,
  _prev: TransportSaveState,
  formData: FormData,
): Promise<TransportSaveState> {
  const ctx = await requireProjectContext(projectId);
  const checked = await checkTransportSave(
    {
      canEdit: canEditCallSheets(ctx),
      canEditFinance: canEditTransportFinance(ctx),
      inProject: inProjectCheck(projectId),
      loadDayTransports,
      budgetItemsUsable: (ids) => checkBudgetItemsUsable(projectId, ctx, ids),
    },
    dayId,
    formData.get("payload") ?? "",
  );
  if ("error" in checked) return { error: checked.error };
  const { plan, existing } = checked;
  const shootDayId = checked.dayId;

  if (!isEmptyPlan(plan)) {
    try {
      await auditMutation(
        ctx,
        (next: TransportSavePlan) =>
          prisma.$transaction(async (tx) => {
            if (next.remove.length > 0) {
              await tx.shootDayTransport.deleteMany({
                where: { shootDayId, id: { in: next.remove } },
              });
            }
            for (const { id, data } of next.update) {
              const { count } = await tx.shootDayTransport.updateMany({
                where: { id, shootDayId },
                data,
              });
              if (count !== 1) throw new TransportChangedError();
            }
            if (next.create.length > 0) {
              await tx.shootDayTransport.createMany({
                data: next.create.map((row) => ({ ...row, shootDayId })),
              });
            }
          }),
        plan,
        {
          projectId,
          entityType: AuditEntityType.callSheet,
          entityId: shootDayId,
          action: "UPDATE",
          summary: `Сохранён спецтранспорт: ${[
            plan.create.length ? `+${plan.create.length}` : "",
            plan.remove.length ? `−${plan.remove.length}` : "",
            plan.update.length ? `изменено ${plan.update.length}` : "",
          ]
            .filter(Boolean)
            .join(", ")}`,
          changes: transportAuditChanges(existing, plan),
        },
      );
    } catch (error) {
      if (error instanceof TransportChangedError) return { error: CHANGED_ELSEWHERE };
      throw error;
    }
    revalidatePath(`/ru/projects/${projectId}/call-sheets/${shootDayId}`);
    revalidatePath(`/ru/projects/${projectId}/call-sheets`);
  }

  const showKmRate = canSeeTransportKmRate(ctx);
  const saved = await loadDayTransports(shootDayId);
  return { success: SAVED, rows: saved.map((row) => toEditorRow(row, showKmRate)) };
}
