import { AuditAction } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";
import type { AuditEntityTypeValue } from "@/shared/audit/entity-types";

type AuditInput = {
  projectId?: string | null;
  userId: string;
  entityType: AuditEntityTypeValue | string;
  entityId: string;
  action: AuditAction;
  summary?: string;
  changes?: Record<string, unknown>;
};

/** Клиент базы или транзакция: запись журнала откатится вместе с действием. */
export type AuditDb = Pick<typeof prisma, "auditLog">;

export async function writeAuditLog(input: AuditInput, db: AuditDb = prisma) {
  await db.auditLog.create({
    data: {
      projectId: input.projectId,
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      summary: input.summary,
      changes: input.changes ?? undefined,
    },
  });
}
