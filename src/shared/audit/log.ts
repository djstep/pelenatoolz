import { AuditAction } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";

type AuditInput = {
  projectId?: string | null;
  userId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  summary?: string;
  changes?: Record<string, unknown>;
};

export async function writeAuditLog(input: AuditInput) {
  await prisma.auditLog.create({
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
