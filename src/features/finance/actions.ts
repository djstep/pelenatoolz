"use server";

import { FinanceOpCategory, FinanceOpType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";

export type FinanceActionState = { error?: string; success?: string };

function revalidateFinance(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/finance`);
  revalidatePath(`/ru/projects/${projectId}`);
}

const opSchema = z.object({
  type: z.enum(FinanceOpType),
  category: z.enum(FinanceOpCategory),
  title: z.string().trim().min(1).max(200),
  amount: z.coerce.number().positive().max(1_000_000_000),
  operationDate: z.string().min(1),
  counterparty: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  actorId: z.string().cuid().optional().or(z.literal("")),
});

export async function createFinanceOpAction(
  projectId: string,
  _prev: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) {
    return { error: "Недостаточно прав" };
  }

  const parsed = opSchema.safeParse({
    type: formData.get("type"),
    category: formData.get("category") || "OTHER",
    title: formData.get("title"),
    amount: formData.get("amount"),
    operationDate: formData.get("operationDate"),
    counterparty: formData.get("counterparty") || undefined,
    notes: formData.get("notes") || undefined,
    actorId: formData.get("actorId") || undefined,
  });

  if (!parsed.success) {
    return { error: "Проверьте данные операции" };
  }

  const op = await prisma.financeOperation.create({
    data: {
      projectId,
      type: parsed.data.type,
      category: parsed.data.category,
      title: parsed.data.title,
      amount: parsed.data.amount,
      operationDate: new Date(parsed.data.operationDate),
      counterparty: parsed.data.counterparty,
      notes: parsed.data.notes,
      actorId: parsed.data.actorId || null,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.financeOp,
    entityId: op.id,
    action: "CREATE",
    summary: `${parsed.data.type === "INCOME" ? "Приход" : "Расход"}: ${op.title}`,
  });

  revalidateFinance(projectId);
  return { success: "Операция добавлена" };
}

export async function updateFinanceOpAction(
  projectId: string,
  opId: string,
  _prev: FinanceActionState,
  formData: FormData,
): Promise<FinanceActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) {
    return { error: "Недостаточно прав" };
  }

  const parsed = opSchema.safeParse({
    type: formData.get("type"),
    category: formData.get("category") || "OTHER",
    title: formData.get("title"),
    amount: formData.get("amount"),
    operationDate: formData.get("operationDate"),
    counterparty: formData.get("counterparty") || undefined,
    notes: formData.get("notes") || undefined,
    actorId: formData.get("actorId") || undefined,
  });

  if (!parsed.success) {
    return { error: "Проверьте данные операции" };
  }

  await prisma.financeOperation.updateMany({
    where: { id: opId, projectId },
    data: {
      type: parsed.data.type,
      category: parsed.data.category,
      title: parsed.data.title,
      amount: parsed.data.amount,
      operationDate: new Date(parsed.data.operationDate),
      counterparty: parsed.data.counterparty,
      notes: parsed.data.notes,
      actorId: parsed.data.actorId || null,
    },
  });

  revalidateFinance(projectId);
  return { success: "Сохранено" };
}

export async function deleteFinanceOpAction(projectId: string, opId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) {
    throw new Error("FORBIDDEN");
  }
  await prisma.financeOperation.deleteMany({ where: { id: opId, projectId } });
  revalidateFinance(projectId);
}
