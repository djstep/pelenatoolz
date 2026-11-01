import { CastingCandidateStatus } from "@prisma/client";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation, type AuditContext, type AuditMeta } from "@/shared/audit/with-audit";

/**
 * «Отказ» снимает снимок у персонажа, если снимок ссылается именно на эту заявку —
 * при любом прежнем статусе. Снимок другой заявки не трогается.
 */
export function shouldClearCastSnapshot(
  nextStatus: CastingCandidateStatus,
  candidateId: string,
  snapshotCandidateId: string | null,
): boolean {
  return nextStatus === CastingCandidateStatus.REJECTED && snapshotCandidateId === candidateId;
}

/** Запись журнала о снятом снимке: только имена, id и статусы — без контактов и ставки. */
export function castSnapshotClearedAuditMeta(input: {
  projectId: string;
  candidateId: string;
  characterId: string;
  characterName: string;
  personName: string;
  previousStatus: CastingCandidateStatus;
}): AuditMeta<null, void> {
  return {
    projectId: input.projectId,
    entityType: AuditEntityType.castingCandidate,
    action: "UPDATE",
    entityId: input.candidateId,
    summary: `Заявка «${input.personName}» на роль «${input.characterName}»: статус «Отказ», снят снимок кандидата у персонажа`,
    changes: {
      candidateId: input.candidateId,
      characterId: input.characterId,
      status: { from: input.previousStatus, to: CastingCandidateStatus.REJECTED },
    },
  };
}

class CastSnapshotNotClearedError extends Error {}

/**
 * Снять снимок и записать это в журнал. `clear` возвращает, у скольких персонажей
 * снимок снят; 0 — снимать было нечего, записи в журнале нет. true — снимок снят.
 */
export async function clearCastSnapshotAudited(
  ctx: AuditContext,
  meta: AuditMeta<null, void>,
  clear: () => Promise<number>,
  audit: typeof auditMutation = auditMutation,
): Promise<boolean> {
  try {
    await audit(
      ctx,
      async () => {
        // auditMutation не пишет журнал, если действие бросило ошибку.
        if ((await clear()) === 0) throw new CastSnapshotNotClearedError();
      },
      null,
      meta,
    );
    return true;
  } catch (error) {
    if (error instanceof CastSnapshotNotClearedError) return false;
    throw error;
  }
}
