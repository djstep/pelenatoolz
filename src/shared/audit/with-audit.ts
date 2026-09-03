import type { AuditAction } from "@prisma/client";
import { writeAuditLog } from "@/shared/audit/log";
import type { AuditEntityTypeValue } from "@/shared/audit/entity-types";

export type AuditContext = {
  user: { id: string };
};

type Resolve<TInput, TResult, TValue> =
  | TValue
  | ((input: TInput, result: TResult) => TValue);

export type AuditMeta<TInput, TResult> = {
  projectId?: string | null;
  entityType: AuditEntityTypeValue | string;
  action: AuditAction;
  entityId: Resolve<TInput, TResult, string>;
  summary: Resolve<TInput, TResult, string>;
  changes?: Resolve<TInput, TResult, Record<string, unknown> | undefined>;
};

function resolve<TInput, TResult, TValue>(
  value: Resolve<TInput, TResult, TValue>,
  input: TInput,
  result: TResult,
): TValue {
  return typeof value === "function"
    ? (value as (input: TInput, result: TResult) => TValue)(input, result)
    : value;
}

/**
 * Wraps a mutating operation and records an audit log after success.
 * If `fn` throws, no log is written.
 */
export async function auditMutation<TInput, TResult>(
  ctx: AuditContext,
  fn: (input: TInput) => Promise<TResult>,
  input: TInput,
  meta: AuditMeta<TInput, TResult>,
): Promise<TResult> {
  const result = await fn(input);
  await writeAuditLog({
    projectId: meta.projectId,
    userId: ctx.user.id,
    entityType: meta.entityType,
    entityId: resolve(meta.entityId, input, result),
    action: meta.action,
    summary: resolve(meta.summary, input, result),
    changes: resolve(meta.changes ?? undefined, input, result),
  });
  return result;
}

/** Record audit after mutation when wrapping the whole function is impractical. */
export async function recordAudit(
  ctx: AuditContext,
  meta: {
    projectId?: string | null;
    entityType: AuditEntityTypeValue | string;
    entityId: string;
    action: AuditAction;
    summary: string;
    changes?: Record<string, unknown>;
  },
): Promise<void> {
  await writeAuditLog({
    ...meta,
    userId: ctx.user.id,
  });
}
