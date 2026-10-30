"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { checkBudgetItemsUsable } from "@/features/smeta/budget-item-access";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type DefaultBudgetItemsState = { error?: string; success?: string };

export type DefaultBudgetItemsTarget = "actor" | "resource" | "location";

const optionalId = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.string().cuid().nullable(),
);

const schema = z.object({
  defaultBudgetItemId: optionalId,
  overtimeBudgetItemId: optionalId,
  mileageBudgetItemId: optionalId,
});

type Current = {
  defaultBudgetItemId: string | null;
  overtimeBudgetItemId: string | null;
  mileageBudgetItemId?: string | null;
};

/**
 * Статьи сметы по умолчанию в карточке актёра, позиции ресурса или объекта: основная оплата,
 * переработка и (у ресурса) км. Право — как на финансовые условия карточки; статья — из сметы,
 * которую пользователь видит (уже стоящую можно оставить).
 */
export async function saveDefaultBudgetItemsAction(
  projectId: string,
  target: DefaultBudgetItemsTarget,
  entityId: string,
  _prev: DefaultBudgetItemsState,
  formData: FormData,
): Promise<DefaultBudgetItemsState> {
  const ctx = await requireProjectContext(projectId);

  const parsed = schema.safeParse({
    defaultBudgetItemId: formData.get("defaultBudgetItemId"),
    overtimeBudgetItemId: formData.get("overtimeBudgetItemId"),
    mileageBudgetItemId: formData.get("mileageBudgetItemId"),
  });
  if (!parsed.success) return { error: "Проверьте статьи" };

  let current: Current;
  try {
    if (target === "actor") {
      if (!ctx.can("cast:write") || !ctx.canFinanceWrite("actors")) {
        return { error: "Недостаточно прав" };
      }
      await assertInProject("Actor", entityId, projectId);
      current = await prisma.actor.findUniqueOrThrow({
        where: { id: entityId },
        select: { defaultBudgetItemId: true, overtimeBudgetItemId: true },
      });
    } else if (target === "location") {
      if (!ctx.can("script:write") || !ctx.canFinanceWrite("locations")) {
        return { error: "Недостаточно прав" };
      }
      await assertInProject("Location", entityId, projectId);
      current = await prisma.location.findUniqueOrThrow({
        where: { id: entityId },
        select: { defaultBudgetItemId: true, overtimeBudgetItemId: true },
      });
    } else {
      await assertInProject("ResourceItem", entityId, projectId);
      const item = await prisma.resourceItem.findUniqueOrThrow({
        where: { id: entityId },
        select: {
          categoryId: true,
          defaultBudgetItemId: true,
          overtimeBudgetItemId: true,
          mileageBudgetItemId: true,
        },
      });
      if (!ctx.can("script:write") || !ctx.canFinanceWrite({ categoryId: item.categoryId })) {
        return { error: "Недостаточно прав" };
      }
      current = item;
    }
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Не найдено" };
    throw error;
  }

  const next = {
    defaultBudgetItemId: parsed.data.defaultBudgetItemId,
    overtimeBudgetItemId: parsed.data.overtimeBudgetItemId,
    ...(target === "resource" ? { mileageBudgetItemId: parsed.data.mileageBudgetItemId } : {}),
  };
  const itemError = await checkBudgetItemsUsable(
    projectId,
    ctx,
    Object.values(next),
    [current.defaultBudgetItemId, current.overtimeBudgetItemId, current.mileageBudgetItemId],
  );
  if (itemError) return { error: itemError };

  if (target === "actor") {
    await prisma.actor.update({ where: { id: entityId }, data: next });
  } else if (target === "location") {
    await prisma.location.update({ where: { id: entityId }, data: next });
  } else {
    await prisma.resourceItem.update({ where: { id: entityId }, data: next });
  }

  await recordAudit(ctx, {
    projectId,
    entityType:
      target === "actor"
        ? AuditEntityType.actor
        : target === "location"
          ? AuditEntityType.location
          : AuditEntityType.resourceItem,
    entityId,
    action: "UPDATE",
    summary: "Статьи сметы по умолчанию",
    changes: { before: current, after: next },
  });

  revalidatePath(`/ru/projects/${projectId}`, "layout");
  return { success: "Статьи сохранены" };
}
