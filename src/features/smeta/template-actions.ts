"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canEditBudgetTemplate } from "@/features/smeta/lib/smeta-access";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

/**
 * Общий шаблон статей сметы фильма. Ведёт только продюсер. Номер статьи выдаётся из счётчика
 * проекта и не переиспользуется; статьи не удаляются — уходят в архив (их могли взять цеха).
 * Любое изменение шаблона идёт под блокировкой строки настроек сметы проекта: номера, порядок
 * и проверка одинаковых названий не путаются при одновременных запросах.
 */

export type TemplateActionState = { error?: string; success?: string };

const NO_RIGHTS = "Шаблон статей ведёт продюсер";
const NOT_FOUND = "Статья не найдена";
const NAME_TAKEN = "Статья с таким названием уже есть";

const nameSchema = z.string().trim().min(1, "Введите название статьи").max(120, "Слишком длинное название");

type TransactionCallback = Extract<
  Parameters<typeof prisma.$transaction>[0],
  (client: never) => Promise<unknown>
>;
type Tx = TransactionCallback extends (client: infer T) => Promise<unknown> ? T : never;

function revalidate(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/smeta/template`);
  revalidatePath(`/ru/projects/${projectId}/smeta`);
}

async function templateContext(projectId: string) {
  const ctx = await requireProjectContext(projectId);
  return canEditBudgetTemplate(ctx) ? ctx : null;
}

/** Id из браузера — строка разумной длины; иное — подделка, отказ без обращения к базе. */
function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

/**
 * Заблокировать шаблон проекта до конца транзакции. Строка настроек создаётся, если её нет
 * (проект создан в обход начальных справочников).
 */
async function lockTemplate(tx: Tx, projectId: string) {
  await tx.projectBudgetSettings.upsert({ where: { projectId }, create: { projectId }, update: {} });
  await tx.$queryRaw`SELECT 1 FROM "ProjectBudgetSettings" WHERE "projectId" = ${projectId} FOR UPDATE`;
}

/** Следующий номер статьи шаблона (под блокировкой шаблона): номера не переиспользуются. */
async function nextArticleNumber(tx: Tx, projectId: string) {
  const settings = await tx.projectBudgetSettings.update({
    where: { projectId },
    data: { lastTemplateArticleNumber: { increment: 1 } },
    select: { lastTemplateArticleNumber: true },
  });
  return settings.lastTemplateArticleNumber;
}

/** Есть ли среди действующих статей шаблона статья с таким названием (без учёта регистра). */
async function nameTaken(tx: Tx, projectId: string, name: string, exceptId?: string) {
  const found = await tx.budgetTemplateArticle.findFirst({
    where: {
      projectId,
      archivedAt: null,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  return found !== null;
}

export async function createTemplateArticleAction(
  projectId: string,
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const ctx = await templateContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };

  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте название" };
  const name = parsed.data;

  const outcome = await prisma.$transaction(async (tx) => {
    await lockTemplate(tx, projectId);
    if (await nameTaken(tx, projectId, name)) return { error: NAME_TAKEN } as const;
    const number = await nextArticleNumber(tx, projectId);
    const last = await tx.budgetTemplateArticle.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    });
    await auditMutation(
      ctx,
      () =>
        tx.budgetTemplateArticle.create({
          data: { projectId, number, name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
          select: { id: true },
        }),
      undefined,
      {
        projectId,
        entityType: AuditEntityType.budgetTemplateArticle,
        action: "CREATE",
        entityId: (_input, row) => row.id,
        summary: `Добавлена статья шаблона сметы «${name}»`,
      },
      { db: tx },
    );
    return { ok: true } as const;
  });
  if ("error" in outcome) return { error: outcome.error };

  revalidate(projectId);
  return { success: "Статья добавлена" };
}

export async function renameTemplateArticleAction(
  projectId: string,
  articleId: string,
  _prev: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const ctx = await templateContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };
  if (!isId(articleId)) return { error: NOT_FOUND };

  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте название" };
  const name = parsed.data;

  const outcome = await prisma.$transaction(async (tx) => {
    await lockTemplate(tx, projectId);
    const existing = await tx.budgetTemplateArticle.findFirst({
      where: { id: articleId, projectId },
      select: { id: true, name: true },
    });
    if (!existing) return { error: NOT_FOUND } as const;
    if (name === existing.name) return { ok: true } as const;
    if (await nameTaken(tx, projectId, name, articleId)) return { error: NAME_TAKEN } as const;
    await auditMutation(
      ctx,
      () => tx.budgetTemplateArticle.update({ where: { id: articleId }, data: { name } }),
      undefined,
      {
        projectId,
        entityType: AuditEntityType.budgetTemplateArticle,
        action: "UPDATE",
        entityId: articleId,
        summary: `Статья шаблона сметы «${existing.name}» переименована в «${name}»`,
        changes: { name: [existing.name, name] },
      },
      { db: tx },
    );
    return { ok: true } as const;
  });
  if ("error" in outcome) return { error: outcome.error };

  revalidate(projectId);
  return { success: "Сохранено" };
}

/** Переставить действующую статью на одну позицию вверх или вниз. */
export async function moveTemplateArticleAction(
  projectId: string,
  articleId: string,
  direction: "up" | "down",
): Promise<TemplateActionState> {
  const ctx = await templateContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };
  if (!isId(articleId)) return { error: NOT_FOUND };
  if (direction !== "up" && direction !== "down") return { error: "Неверное направление" };

  const outcome = await prisma.$transaction(async (tx) => {
    // Порядок пересчитывается целиком под блокировкой: параллельные перестановки не перемешают его.
    await lockTemplate(tx, projectId);
    const active = await tx.budgetTemplateArticle.findMany({
      where: { projectId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
      select: { id: true, name: true },
    });
    const index = active.findIndex((a) => a.id === articleId);
    if (index < 0) return { error: NOT_FOUND } as const;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= active.length) return { unchanged: true } as const;

    const order = [...active];
    [order[index], order[target]] = [order[target]!, order[index]!];
    await auditMutation(
      ctx,
      async () => {
        for (const [sortOrder, row] of order.entries()) {
          await tx.budgetTemplateArticle.update({ where: { id: row.id }, data: { sortOrder } });
        }
      },
      undefined,
      {
        projectId,
        entityType: AuditEntityType.budgetTemplateArticle,
        action: "UPDATE",
        entityId: articleId,
        summary: `Статья шаблона сметы «${active[index]!.name}» перемещена ${direction === "up" ? "выше" : "ниже"}`,
      },
      { db: tx },
    );
    return { moved: true } as const;
  });

  if ("error" in outcome) return { error: outcome.error };
  revalidate(projectId);
  return { success: "Порядок сохранён" };
}

/** Убрать статью в архив или вернуть. Статья не удаляется: её могли взять цеха. */
export async function setTemplateArticleArchivedAction(
  projectId: string,
  articleId: string,
  archived: boolean,
): Promise<TemplateActionState> {
  const ctx = await templateContext(projectId);
  if (!ctx) return { error: NO_RIGHTS };
  if (!isId(articleId) || typeof archived !== "boolean") return { error: NOT_FOUND };

  const outcome = await prisma.$transaction(async (tx) => {
    await lockTemplate(tx, projectId);
    const existing = await tx.budgetTemplateArticle.findFirst({
      where: { id: articleId, projectId },
      select: { id: true, name: true, archivedAt: true },
    });
    if (!existing) return { error: NOT_FOUND } as const;
    if ((existing.archivedAt !== null) === archived) return { unchanged: true } as const;
    if (!archived && (await nameTaken(tx, projectId, existing.name, articleId))) {
      return {
        error: "Среди действующих уже есть статья с таким названием — сначала переименуйте её",
      } as const;
    }
    const last = archived
      ? null
      : await tx.budgetTemplateArticle.aggregate({
          where: { projectId, archivedAt: null },
          _max: { sortOrder: true },
        });
    await auditMutation(
      ctx,
      () =>
        tx.budgetTemplateArticle.update({
          where: { id: articleId },
          data: archived
            ? { archivedAt: new Date() }
            : // Вернувшаяся статья встаёт в конец действующих.
              { archivedAt: null, sortOrder: (last?._max.sortOrder ?? -1) + 1 },
        }),
      undefined,
      {
        projectId,
        entityType: AuditEntityType.budgetTemplateArticle,
        action: "UPDATE",
        entityId: articleId,
        summary: archived
          ? `Статья шаблона сметы «${existing.name}» убрана в архив`
          : `Статья шаблона сметы «${existing.name}» возвращена из архива`,
      },
      { db: tx },
    );
    return { ok: true } as const;
  });
  if ("error" in outcome) return { error: outcome.error };

  revalidate(projectId);
  return { success: archived ? "Статья в архиве" : "Статья возвращена" };
}
