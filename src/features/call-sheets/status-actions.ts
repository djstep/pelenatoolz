"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  isCallSheetEditRefused,
  parseExpectedRevision,
  REVISION_CONFLICT,
} from "@/features/call-sheets/lib/revision";
import {
  applyStatusCommand,
  canRunStatusCommand,
  planStatusTransition,
  STATUS_COMMAND_SUMMARY,
  type StatusCommand,
  type StatusRights,
} from "@/features/call-sheets/lib/status-rules";
import {
  canEditCallSheets,
  checkCallSheetCommand,
  DAY_NOT_FOUND,
  NO_RIGHTS,
} from "@/features/call-sheets/lib/template-rules";
import { buildLiveCallSheet } from "@/features/call-sheets/print/load-print-model";
import { lockCallSheetRow } from "@/features/call-sheets/revision-db";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type CallSheetStatusResult = { error?: string; revision?: number | null };

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Общий ход перехода: права (до базы) → день проекта → под блокировкой строки вызывного
 * (`SELECT … FOR UPDATE`) сверка номера правки и статуса → запись. При утверждении — ещё
 * снимок модели листа (`CallSheetApprovedVersion`) в той же транзакции.
 */
async function runStatusCommand(
  projectId: string,
  dayId: string,
  command: StatusCommand,
  revision: unknown,
): Promise<CallSheetStatusResult> {
  const ctx = await requireProjectContext(projectId);
  const rights: StatusRights = {
    canEdit: canEditCallSheets(ctx),
    canApprove: ctx.can("callsheet:approve"),
  };
  if (!canRunStatusCommand(command, rights)) return { error: NO_RIGHTS };

  // Права уже проверены выше (у утверждения — своё право), здесь — только день проекта.
  const checked = await checkCallSheetCommand(
    {
      canEdit: true,
      inProject: async (entity, ids) => {
        try {
          await assertInProject(entity, ids, projectId);
          return true;
        } catch (error) {
          if (isNotInProjectError(error)) return false;
          throw error;
        }
      },
    },
    dayId,
  );
  if ("error" in checked) return { error: checked.error };
  const expected = parseExpectedRevision(revision);

  const current = await prisma.callSheet.findFirst({
    where: { projectId, shootDayId: checked.dayId },
    select: {
      id: true,
      status: true,
      version: true,
      revision: true,
      shootDay: { select: { dayNumber: true } },
    },
  });
  // Быстрый отказ без сборки листа; окончательная проверка — под блокировкой.
  const early = planStatusTransition(command, rights, current, expected);
  if ("error" in early) return early;

  // Лист для снимка строится до блокировки: внутри транзакции не ждём прогноз погоды и не
  // держим строку. Это безопасно: любая правка вызывного меняет номер правки в той же
  // транзакции, что и данные, — если под блокировкой номер всё ещё прежний, лист собран
  // ровно из этих данных; если нет — отказ «изменили в другом окне».
  let live: Awaited<ReturnType<typeof buildLiveCallSheet>> = null;
  if (command === "approve") {
    live = await buildLiveCallSheet(projectId, checked.dayId);
    if (!live) return { error: DAY_NOT_FOUND };
  }

  const dayNumber = current!.shootDay.dayNumber;
  let done;
  try {
    done = await auditMutation(
      ctx,
      (cmd: StatusCommand) =>
        prisma.$transaction((tx) =>
          applyStatusCommand(
            {
              lockCallSheet: (shootDayId) => lockCallSheetRow(tx, projectId, shootDayId),
              // Снимок не редактируется: пишется один раз, версия — уникальна у вызывного.
              createApprovedVersion: async (callSheetId, version, approvedAt) => {
                await tx.callSheetApprovedVersion.create({
                  data: {
                    callSheetId,
                    version,
                    approvedAt,
                    approvedById: ctx.user.id,
                    snapshot: live!.model as unknown as Prisma.InputJsonValue,
                    modelHash: live!.dataHash,
                  },
                });
              },
              updateCallSheet: async (callSheetId, { approval, ...data }) => {
                await tx.callSheet.update({
                  where: { id: callSheetId },
                  data: {
                    ...data,
                    ...(approval.kind === "set"
                      ? { approvedAt: approval.at, approvedById: ctx.user.id }
                      : approval.kind === "clear"
                        ? { approvedAt: null, approvedById: null }
                        : {}),
                  },
                });
              },
            },
            checked.dayId,
            cmd,
            rights,
            expected,
            new Date(),
          ),
        ),
      command,
      {
        projectId,
        entityType: AuditEntityType.callSheetStatus,
        action: "UPDATE",
        entityId: (_cmd, result) => result.callSheetId,
        summary: `Вызывной дня ${dayNumber} ${STATUS_COMMAND_SUMMARY[command]}`,
        // Снимок листа в журнал не пишем — только статус и версия.
        changes: (_cmd, result) => ({
          status: { from: result.from.status, to: result.to.status },
          version: { from: result.from.version, to: result.to.version },
        }),
      },
    );
  } catch (error) {
    if (isCallSheetEditRefused(error)) return { error: error.message };
    // Два окна утверждают одну версию: второе упирается в уникальность версии.
    if (isUniqueError(error)) return { error: REVISION_CONFLICT };
    throw error;
  }

  revalidatePath(`/ru/projects/${projectId}/call-sheets/${checked.dayId}`);
  revalidatePath(`/ru/projects/${projectId}/call-sheets`);
  return { revision: done.revision };
}

/** «На согласование» — право правки вызывного. */
export async function submitCallSheetForReviewAction(
  projectId: string,
  dayId: string,
  revision: unknown,
): Promise<CallSheetStatusResult> {
  return runStatusCommand(projectId, dayId, "submit", revision);
}

/** «Вернуть в черновик» — право правки или «Вызывные — утверждение». */
export async function returnCallSheetToDraftAction(
  projectId: string,
  dayId: string,
  revision: unknown,
): Promise<CallSheetStatusResult> {
  return runStatusCommand(projectId, dayId, "return", revision);
}

/** «Утвердить» — только «Вызывные — утверждение»; снимок листа — версия N. */
export async function approveCallSheetAction(
  projectId: string,
  dayId: string,
  revision: unknown,
): Promise<CallSheetStatusResult> {
  return runStatusCommand(projectId, dayId, "approve", revision);
}

/** «Внести изменения» у утверждённого — право правки; черновик версии +1. */
export async function reopenCallSheetAction(
  projectId: string,
  dayId: string,
  revision: unknown,
): Promise<CallSheetStatusResult> {
  return runStatusCommand(projectId, dayId, "reopen", revision);
}
