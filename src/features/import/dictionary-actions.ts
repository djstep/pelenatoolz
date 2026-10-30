"use server";

import { revalidatePath } from "next/cache";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

/**
 * Удалить правило словаря проекта: при следующем импорте вопрос задастся снова.
 * Только с правом правки сценария; правило — этого проекта.
 */
export async function deleteDictionaryRuleAction(
  projectId: string,
  ruleId: string,
): Promise<{ error?: string; success?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };
  try {
    await assertInProject("ScriptDictionaryRule", ruleId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Правило не найдено" };
    throw error;
  }

  const rule = await prisma.scriptDictionaryRule.delete({
    where: { id: ruleId, projectId },
    select: { type: true, key: true, answer: true },
  });
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.scriptDictionaryRule,
    entityId: ruleId,
    action: "DELETE",
    summary: `Правило словаря удалено: ${rule.type} «${rule.key}» → ${rule.answer}`,
  });

  revalidatePath(`/ru/projects/${projectId}/screenplay/dictionary`);
  return { success: "Правило удалено — вопрос снова задастся при импорте" };
}
