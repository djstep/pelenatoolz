"use server";

import { Prisma, type AuditAction } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { assertInProject, isNotInProjectError } from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { loadBudgetVariables, variableValueMap } from "@/features/smeta/items-queries";
import { calcItem, MAX_LINE_MONEY, multipliersOf, type VariableValues } from "@/features/smeta/lib/item-calc";
import { isItemArchived } from "@/features/smeta/lib/item-where";
import { isId, lineCode, parseLineInput, parseName, type LineInput } from "@/features/smeta/lib/item-input";
import { canEditDepartmentSmeta } from "@/features/smeta/lib/smeta-access";
import { lockBudget, statusAfterEdit, type Tx } from "@/features/smeta/queries";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";
import { z } from "zod";
import { checkZipLimits, IMPORT_LIMITS, ImportError } from "@/features/smeta/lib/import-xlsx";
import {
  IMPORT_FIELD_IDS,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  parseMultipliersText,
  type ImportFieldId,
} from "@/features/smeta/lib/items-import";

/**
 * Действия над сметой цеха по статьям: взять статью из шаблона, добавить подстатью и строку,
 * изменить, переместить внутри уровня, убрать в архив и вернуть. Править может только глава
 * этого цеха. Каждое действие — одна транзакция под блокировкой сметы: ревизия растёт, правка
 * отправленной или утверждённой сметы возвращает её в «черновик», запись журнала — в той же
 * транзакции. Внутренние коды строк на экран и в журнал не выводятся.
 */

/** `revision` — ревизия сметы после правки (для отправки на утверждение). */
export type ItemsActionState = { error?: string; success?: string; id?: string; revision?: number };

const NO_RIGHTS = "Смету цеха правит глава цеха";
const NOT_FOUND = "Не найдено";
const NO_BUDGET = "Сначала создайте смету цеха";

/** Отказ внутри транзакции: всё откатывается, пользователь видит текст. */
class ItemsError extends Error {}
/** Ничего не изменилось: всё откатывается, пользователь видит обычный ответ, не ошибку. */
class NoChange extends Error {}

function revalidate(projectId: string, departmentId: string) {
  revalidatePath(`/ru/projects/${projectId}/smeta`);
  revalidatePath(`/ru/projects/${projectId}/smeta/${departmentId}`, "layout");
}

type Access = {
  ctx: Awaited<ReturnType<typeof requireProjectContext>>;
  budget: { id: string; departmentId: string; departmentName: string; codePrefix: string };
};

/** Вход, цех этого проекта, право главы этого цеха и смета цеха. */
async function editorAccess(
  projectId: string,
  departmentId: unknown,
): Promise<{ ok: false; error: string } | ({ ok: true } & Access)> {
  const ctx = await requireProjectContext(projectId);
  if (!isId(departmentId)) return { ok: false, error: NOT_FOUND };
  try {
    await assertInProject("Department", departmentId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { ok: false, error: NOT_FOUND };
    throw error;
  }
  if (!canEditDepartmentSmeta(ctx, departmentId)) return { ok: false, error: NO_RIGHTS };
  const budget = await prisma.budget.findFirst({
    where: { projectId, departmentId },
    select: { id: true, department: { select: { name: true, codePrefix: true } } },
  });
  if (!budget) return { ok: false, error: NO_BUDGET };
  return {
    ok: true,
    ctx,
    budget: {
      id: budget.id,
      departmentId,
      departmentName: budget.department.name,
      codePrefix: budget.department.codePrefix,
    },
  };
}

type WriteResult = { entityId: string; summary: string; changes?: Record<string, unknown> };

/**
 * Правка сметы в одной транзакции: блокировка сметы, запись и журнал, ревизия +1, статус после
 * правки (отправленная или утверждённая — снова «черновик», с записью в журнал).
 */
async function editBudget(
  projectId: string,
  access: Access,
  action: AuditAction,
  write: (tx: Tx) => Promise<WriteResult>,
  options: { timeout?: number } = {},
): Promise<{ error: string } | { unchanged: true } | { result: WriteResult; revision: number }> {
  const { ctx, budget } = access;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await lockBudget(tx, budget.id);
        const current = await tx.budget.findUniqueOrThrow({ where: { id: budget.id }, select: { status: true } });
        const result = await auditMutation(ctx, () => write(tx), undefined, {
          projectId,
          entityType: AuditEntityType.budget,
          action,
          entityId: budget.id,
          summary: (_input, r) => `Смета цеха «${budget.departmentName}»: ${r.summary}`,
          changes: (_input, r) => ({ target: r.entityId, ...r.changes }),
        }, { db: tx });

        const status = statusAfterEdit(current.status);
        const updated = await tx.budget.update({
          where: { id: budget.id },
          data: { revision: { increment: 1 }, ...status.data },
          select: { revision: true },
        });
        if (status.change) {
          await auditMutation(ctx, async () => null, undefined, {
            projectId,
            entityType: AuditEntityType.budget,
            action: "UPDATE",
            entityId: budget.id,
            summary:
              status.change === "changed_after_submit"
                ? `Смета цеха «${budget.departmentName}» изменена после отправки на утверждение — статус «черновик»`
                : `Смета цеха «${budget.departmentName}» изменена после утверждения — статус «черновик»`,
          }, { db: tx });
        }
        return { result, revision: updated.revision };
      },
      { timeout: options.timeout ?? 20_000 },
    );
    return result;
  } catch (error) {
    if (error instanceof ItemsError) return { error: error.message };
    if (error instanceof NoChange) return { unchanged: true };
    throw error;
  }
}

function done(
  projectId: string,
  departmentId: string,
  outcome: { error: string } | { unchanged: true } | { result: WriteResult; revision: number },
  success: string,
): ItemsActionState {
  if ("error" in outcome) return { error: outcome.error };
  if ("unchanged" in outcome) return { success: "Без изменений" };
  revalidate(projectId, departmentId);
  return { success, id: outcome.result.entityId, revision: outcome.revision };
}

// ---------------------------------------------------------------------------
// Статья: взять из шаблона
// ---------------------------------------------------------------------------

export async function takeTemplateArticleAction(
  projectId: string,
  departmentId: string,
  templateArticleId: string,
): Promise<ItemsActionState> {
  const access = await editorAccess(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  if (!isId(templateArticleId)) return { error: NOT_FOUND };
  try {
    await assertInProject("BudgetTemplateArticle", templateArticleId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: NOT_FOUND };
    throw error;
  }

  const outcome = await editBudget(projectId, access, "CREATE", async (tx) => {
    const template = await tx.budgetTemplateArticle.findFirst({
      where: { id: templateArticleId, projectId },
      select: { name: true, archivedAt: true },
    });
    if (!template) throw new ItemsError(NOT_FOUND);
    if (template.archivedAt) throw new ItemsError("Статья шаблона в архиве — её не берут");
    const existing = await tx.budgetArticle.findUnique({
      where: { budgetId_templateArticleId: { budgetId: access.budget.id, templateArticleId } },
      select: { id: true, archivedAt: true },
    });
    if (existing && !existing.archivedAt) throw new ItemsError("Эта статья уже есть в смете");
    const article = existing
      ? await tx.budgetArticle.update({ where: { id: existing.id }, data: { archivedAt: null }, select: { id: true } })
      : await tx.budgetArticle.create({
          data: { projectId, budgetId: access.budget.id, templateArticleId },
          select: { id: true },
        });
    return { entityId: article.id, summary: `взята статья «${template.name}»` };
  });
  return done(projectId, departmentId, outcome, "Статья добавлена в смету");
}

// ---------------------------------------------------------------------------
// Подстатья
// ---------------------------------------------------------------------------

async function articleOfBudget(tx: Tx, projectId: string, budgetId: string, articleId: string) {
  const article = await tx.budgetArticle.findFirst({
    where: { id: articleId, projectId, budgetId },
    select: { id: true, archivedAt: true, templateArticle: { select: { name: true, number: true } } },
  });
  if (!article) throw new ItemsError(NOT_FOUND);
  return article;
}

async function subarticleOfBudget(tx: Tx, projectId: string, budgetId: string, subarticleId: string) {
  const sub = await tx.budgetSubarticle.findFirst({
    where: { id: subarticleId, projectId, article: { budgetId } },
    select: {
      id: true,
      name: true,
      number: true,
      archivedAt: true,
      articleId: true,
      article: { select: { archivedAt: true, templateArticle: { select: { number: true } } } },
    },
  });
  if (!sub) throw new ItemsError(NOT_FOUND);
  return sub;
}

export async function addSubarticleAction(
  projectId: string,
  departmentId: string,
  articleId: string,
  rawName: unknown,
): Promise<ItemsActionState> {
  const access = await editorAccess(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  if (!isId(articleId)) return { error: NOT_FOUND };
  const name = parseName(rawName, 200);
  if (!name.ok) return { error: name.error };

  const outcome = await editBudget(projectId, access, "CREATE", async (tx) => {
    const article = await articleOfBudget(tx, projectId, access.budget.id, articleId);
    if (article.archivedAt) throw new ItemsError("Статья в архиве — сначала верните её");
    // Номер подстатьи из счётчика статьи: не переиспользуется.
    const { lastSubarticleNumber: number } = await tx.budgetArticle.update({
      where: { id: articleId },
      data: { lastSubarticleNumber: { increment: 1 } },
      select: { lastSubarticleNumber: true },
    });
    const last = await tx.budgetSubarticle.aggregate({ where: { articleId }, _max: { sortOrder: true } });
    const sub = await tx.budgetSubarticle.create({
      data: { projectId, articleId, number, name: name.value, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      select: { id: true },
    });
    return { entityId: sub.id, summary: `в статью «${article.templateArticle.name}» добавлена подстатья «${name.value}»` };
  });
  return done(projectId, departmentId, outcome, "Подстатья добавлена");
}

export async function renameSubarticleAction(
  projectId: string,
  departmentId: string,
  subarticleId: string,
  rawName: unknown,
): Promise<ItemsActionState> {
  const access = await editorAccess(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  if (!isId(subarticleId)) return { error: NOT_FOUND };
  const name = parseName(rawName, 200);
  if (!name.ok) return { error: name.error };
  const current = await prisma.budgetSubarticle.findFirst({
    where: { id: subarticleId, projectId, article: { budgetId: access.budget.id } },
    select: { name: true },
  });
  if (!current) return { error: NOT_FOUND };
  // Ничего не изменилось — ничего не пишем: смета не должна уходить в «черновик» зря.
  if (current.name === name.value) return { success: "Сохранено", id: subarticleId };

  const outcome = await editBudget(projectId, access, "UPDATE", async (tx) => {
    const sub = await subarticleOfBudget(tx, projectId, access.budget.id, subarticleId);
    await tx.budgetSubarticle.update({ where: { id: sub.id }, data: { name: name.value } });
    return {
      entityId: sub.id,
      summary: `подстатья «${sub.name}» переименована в «${name.value}»`,
      changes: { name: [sub.name, name.value] },
    };
  });
  return done(projectId, departmentId, outcome, "Сохранено");
}

// ---------------------------------------------------------------------------
// Строка
// ---------------------------------------------------------------------------

/**
 * Ссылки строки — переменные, тип расхода, форма оплаты — из этого проекта. Новый выбор
 * архивного типа или формы не принимается (оставить прежний архивный — можно).
 */
async function checkLineRefs(
  projectId: string,
  input: LineInput,
  current?: { expenseTypeId: string | null; paymentFormId: string | null },
): Promise<string | null> {
  const variableIds = input.multipliers.flatMap((m) => (m && "variableId" in m ? [m.variableId] : []));
  try {
    await assertInProject("ProjectFinanceVariable", variableIds, projectId);
    if (input.expenseTypeId) await assertInProject("ProjectExpenseType", input.expenseTypeId, projectId);
    if (input.paymentFormId) await assertInProject("ProjectPaymentForm", input.paymentFormId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return "Переменная, тип расхода или форма оплаты не найдены";
    throw error;
  }
  if (input.expenseTypeId && input.expenseTypeId !== current?.expenseTypeId) {
    const type = await prisma.projectExpenseType.findFirst({
      where: { id: input.expenseTypeId, projectId },
      select: { archivedAt: true },
    });
    if (type?.archivedAt) return "Тип расхода в архиве — выберите другой";
  }
  if (input.paymentFormId && input.paymentFormId !== current?.paymentFormId) {
    const form = await prisma.projectPaymentForm.findFirst({
      where: { id: input.paymentFormId, projectId },
      select: { archivedAt: true },
    });
    if (form?.archivedAt) return "Форма оплаты в архиве — выберите другую";
  }
  return null;
}

/** Процент налога формы оплаты (копия в строку). */
async function formTaxPercent(tx: Tx, paymentFormId: string | null): Promise<string | null> {
  if (!paymentFormId) return null;
  const form = await tx.projectPaymentForm.findUnique({
    where: { id: paymentFormId },
    select: { defaultTaxPercent: true },
  });
  return form?.defaultTaxPercent?.toString() ?? null;
}

/** Поля строки для записи: значения, множители, кэш сумм (без суммы — 0, см. расчёт в дереве). */
async function lineData(
  tx: Tx,
  projectId: string,
  input: LineInput,
  taxPercent: string | null,
  preloaded?: VariableValues,
) {
  const values = preloaded ?? variableValueMap(await loadBudgetVariables(projectId, tx));
  const calc = calcItem(
    { quantity: input.quantity, rate: input.rate, multipliers: input.multipliers, taxPercent },
    values,
  );
  // Столбцы денег в базе — Decimal(18, 2): больше не поместится.
  if (calc.total && calc.total.greaterThan(MAX_LINE_MONEY)) {
    throw new ItemsError("Сумма строки слишком большая — проверьте количество, ставку и множители");
  }
  const [m1, m2, m3] = input.multipliers;
  const slot = (m: LineInput["multipliers"][number]) => ({
    variableId: m && "variableId" in m ? m.variableId : null,
    value: m && "value" in m ? new Prisma.Decimal(m.value) : null,
  });
  const s1 = slot(m1);
  const s2 = slot(m2);
  const s3 = slot(m3);
  return {
    calc,
    data: {
      name: input.name,
      unit: input.unit,
      quantity: input.quantity == null ? null : new Prisma.Decimal(input.quantity),
      rate: input.rate == null ? null : new Prisma.Decimal(input.rate),
      expenseTypeId: input.expenseTypeId,
      paymentFormId: input.paymentFormId,
      taxPercent: taxPercent == null ? null : new Prisma.Decimal(taxPercent),
      multiplier1VariableId: s1.variableId,
      multiplier1Value: s1.value,
      multiplier2VariableId: s2.variableId,
      multiplier2Value: s2.value,
      multiplier3VariableId: s3.variableId,
      multiplier3Value: s3.value,
      // Кэш для старых отчётов; строка без суммы (пустая переменная, нет кол-ва или ставки) — 0,
      // экран и итоги считают её отдельно и помечают.
      amount: new Prisma.Decimal(calc.amount?.toFixed(2) ?? 0),
      tax: new Prisma.Decimal(calc.tax?.toFixed(2) ?? 0),
      total: new Prisma.Decimal(calc.total?.toFixed(2) ?? 0),
    },
  };
}

export async function addLineAction(
  projectId: string,
  departmentId: string,
  subarticleId: string,
  payload: unknown,
): Promise<ItemsActionState> {
  const access = await editorAccess(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  if (!isId(subarticleId)) return { error: NOT_FOUND };
  const parsed = parseLineInput(payload);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;
  const refError = await checkLineRefs(projectId, input);
  if (refError) return { error: refError };

  const outcome = await editBudget(projectId, access, "CREATE", async (tx) => {
    const sub = await subarticleOfBudget(tx, projectId, access.budget.id, subarticleId);
    if (sub.archivedAt || sub.article.archivedAt) throw new ItemsError("Подстатья в архиве — сначала верните её");

    const { number, code } = await allocateLine(tx, projectId, access, sub);

    const taxPercent = input.taxPercent !== undefined ? input.taxPercent : await formTaxPercent(tx, input.paymentFormId);
    const { data } = await lineData(tx, projectId, input, taxPercent);
    const last = await tx.budgetItem.aggregate({ where: { subarticleId: sub.id }, _max: { sortOrder: true } });
    const item = await tx.budgetItem.create({
      data: {
        projectId,
        departmentId: access.budget.departmentId,
        subarticleId: sub.id,
        number,
        code,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        ...data,
      },
      select: { id: true },
    });
    return { entityId: item.id, summary: `в подстатью «${sub.name}» добавлена строка «${input.name}»` };
  });
  return done(projectId, departmentId, outcome, "Строка добавлена");
}

export async function updateLineAction(
  projectId: string,
  departmentId: string,
  itemId: string,
  payload: unknown,
): Promise<ItemsActionState> {
  const access = await editorAccess(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  if (!isId(itemId)) return { error: NOT_FOUND };
  const parsed = parseLineInput(payload);
  if (!parsed.ok) return { error: parsed.error };
  const input = parsed.value;

  const before = await prisma.budgetItem.findFirst({
    where: { id: itemId, projectId, subarticle: { article: { budgetId: access.budget.id } } },
    select: {
      name: true,
      unit: true,
      quantity: true,
      rate: true,
      expenseTypeId: true,
      paymentFormId: true,
      taxPercent: true,
      multiplier1VariableId: true,
      multiplier1Value: true,
      multiplier2VariableId: true,
      multiplier2Value: true,
      multiplier3VariableId: true,
      multiplier3Value: true,
    },
  });
  if (!before) return { error: NOT_FOUND };
  // Ничего не изменилось — ничего не пишем: смета не должна уходить в «черновик» зря.
  if (sameLine(before, input)) return { success: "Сохранено", id: itemId };
  const refError = await checkLineRefs(projectId, input, before);
  if (refError) return { error: refError };

  const outcome = await editBudget(projectId, access, "UPDATE", async (tx) => {
    const item = await tx.budgetItem.findFirst({
      where: { id: itemId, projectId, subarticle: { article: { budgetId: access.budget.id } } },
      select: {
        id: true,
        name: true,
        total: true,
        paymentFormId: true,
        taxPercent: true,
        archivedAt: true,
        subarticle: { select: { archivedAt: true, article: { select: { archivedAt: true } } } },
      },
    });
    if (!item) throw new ItemsError(NOT_FOUND);
    if (isItemArchived(item)) throw new ItemsError("Строка в архиве — сначала верните её");
    // Налог %: прислан — он; не прислан и форма оплаты сменилась — процент новой формы; иначе прежний.
    const taxPercent =
      input.taxPercent !== undefined
        ? input.taxPercent
        : input.paymentFormId !== item.paymentFormId
          ? await formTaxPercent(tx, input.paymentFormId)
          : (item.taxPercent?.toString() ?? null);
    const { data, calc } = await lineData(tx, projectId, input, taxPercent);
    await tx.budgetItem.update({ where: { id: item.id }, data });
    const changes: Record<string, unknown> = {};
    if (item.name !== input.name) changes.name = [item.name, input.name];
    const newTotal = calc.total?.toFixed(2) ?? null;
    if (newTotal !== item.total.toFixed(2)) changes.total = [item.total.toFixed(2), newTotal];
    return { entityId: item.id, summary: `изменена строка «${input.name}»`, changes };
  });
  return done(projectId, departmentId, outcome, "Сохранено");
}

type StoredLine = {
  name: string;
  unit: string | null;
  quantity: Prisma.Decimal | null;
  rate: Prisma.Decimal | null;
  expenseTypeId: string | null;
  paymentFormId: string | null;
  taxPercent: Prisma.Decimal | null;
  multiplier1VariableId: string | null;
  multiplier1Value: Prisma.Decimal | null;
  multiplier2VariableId: string | null;
  multiplier2Value: Prisma.Decimal | null;
  multiplier3VariableId: string | null;
  multiplier3Value: Prisma.Decimal | null;
};

/** Присланная строка совпадает с сохранённой (налог не прислан и форма та же — тоже совпадение). */
function sameLine(stored: StoredLine, input: LineInput): boolean {
  const num = (a: Prisma.Decimal | null, b: string | null) =>
    a == null || b == null ? a == null && b == null : a.equals(b);
  const slot = (variableId: string | null, value: Prisma.Decimal | null, m: LineInput["multipliers"][number]) =>
    m == null
      ? variableId == null && value == null
      : "variableId" in m
        ? variableId === m.variableId && value == null
        : variableId == null && num(value, m.value);
  const [m1, m2, m3] = input.multipliers;
  return (
    stored.name === input.name &&
    stored.unit === input.unit &&
    num(stored.quantity, input.quantity) &&
    num(stored.rate, input.rate) &&
    stored.expenseTypeId === input.expenseTypeId &&
    stored.paymentFormId === input.paymentFormId &&
    (input.taxPercent === undefined || num(stored.taxPercent, input.taxPercent)) &&
    slot(stored.multiplier1VariableId, stored.multiplier1Value, m1) &&
    slot(stored.multiplier2VariableId, stored.multiplier2Value, m2) &&
    slot(stored.multiplier3VariableId, stored.multiplier3Value, m3)
  );
}

// ---------------------------------------------------------------------------
// Перемещение и архив
// ---------------------------------------------------------------------------

/** Переставить подстатью внутри статьи или строку внутри подстатьи на одну позицию. */
export async function moveItemsNodeAction(
  projectId: string,
  departmentId: string,
  level: "subarticle" | "line",
  id: string,
  direction: "up" | "down",
): Promise<ItemsActionState> {
  const access = await editorAccess(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  if ((level !== "subarticle" && level !== "line") || !isId(id) || (direction !== "up" && direction !== "down")) {
    return { error: NOT_FOUND };
  }

  const outcome = await editBudget(projectId, access, "UPDATE", async (tx) => {
    const siblings =
      level === "subarticle"
        ? await (async () => {
            const sub = await subarticleOfBudget(tx, projectId, access.budget.id, id);
            if (sub.article.archivedAt) throw new ItemsError("Статья в архиве — сначала верните её");
            return tx.budgetSubarticle.findMany({
              where: { articleId: sub.articleId, archivedAt: null },
              orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
              select: { id: true, name: true },
            });
          })()
        : await (async () => {
            const item = await tx.budgetItem.findFirst({
              where: { id, projectId, subarticle: { article: { budgetId: access.budget.id } } },
              select: {
                subarticleId: true,
                subarticle: { select: { archivedAt: true, article: { select: { archivedAt: true } } } },
              },
            });
            if (!item?.subarticleId) throw new ItemsError(NOT_FOUND);
            if (isItemArchived({ archivedAt: null, subarticle: item.subarticle })) {
              throw new ItemsError("Подстатья или статья в архиве — сначала верните её");
            }
            return tx.budgetItem.findMany({
              where: { subarticleId: item.subarticleId, archivedAt: null },
              orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
              select: { id: true, name: true },
            });
          })();
    const index = siblings.findIndex((s) => s.id === id);
    if (index < 0) throw new ItemsError("В архиве — сначала верните");
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= siblings.length) throw new NoChange();
    const order = [...siblings];
    [order[index], order[target]] = [order[target]!, order[index]!];
    for (const [sortOrder, row] of order.entries()) {
      if (level === "subarticle") {
        await tx.budgetSubarticle.update({ where: { id: row.id }, data: { sortOrder } });
      } else {
        await tx.budgetItem.update({ where: { id: row.id }, data: { sortOrder } });
      }
    }
    const what = level === "subarticle" ? "подстатья" : "строка";
    return {
      entityId: id,
      summary: `${what} «${siblings[index]!.name}» перемещена ${direction === "up" ? "выше" : "ниже"}`,
    };
  });
  return done(projectId, departmentId, outcome, "Порядок сохранён");
}

/**
 * Убрать в архив или вернуть статью, подстатью или строку. Ничего не удаляется: на строки
 * ссылаются начисления и платежи. Архивное не входит в итоги; вложенное сохраняет свои отметки.
 */
export async function setItemsNodeArchivedAction(
  projectId: string,
  departmentId: string,
  level: "article" | "subarticle" | "line",
  id: string,
  archived: boolean,
): Promise<ItemsActionState> {
  const access = await editorAccess(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  if (!["article", "subarticle", "line"].includes(level) || !isId(id) || typeof archived !== "boolean") {
    return { error: NOT_FOUND };
  }

  const outcome = await editBudget(projectId, access, "UPDATE", async (tx) => {
    const archivedAt = archived ? new Date() : null;
    let name: string;
    let what: string;
    if (level === "article") {
      const article = await articleOfBudget(tx, projectId, access.budget.id, id);
      if ((article.archivedAt !== null) === archived) throw new NoChange();
      await tx.budgetArticle.update({ where: { id }, data: { archivedAt } });
      name = article.templateArticle.name;
      what = "статья";
    } else if (level === "subarticle") {
      const sub = await subarticleOfBudget(tx, projectId, access.budget.id, id);
      if ((sub.archivedAt !== null) === archived) throw new NoChange();
      if (!archived && sub.article.archivedAt) throw new ItemsError("Статья в архиве — сначала верните её");
      // Вернувшаяся подстатья встаёт в конец действующих.
      const last = archived
        ? null
        : await tx.budgetSubarticle.aggregate({ where: { articleId: sub.articleId, archivedAt: null }, _max: { sortOrder: true } });
      await tx.budgetSubarticle.update({
        where: { id },
        data: archived ? { archivedAt } : { archivedAt, sortOrder: (last?._max.sortOrder ?? -1) + 1 },
      });
      name = sub.name;
      what = "подстатья";
    } else {
      const item = await tx.budgetItem.findFirst({
        where: { id, projectId, subarticle: { article: { budgetId: access.budget.id } } },
        select: {
          name: true,
          archivedAt: true,
          subarticleId: true,
          subarticle: { select: { archivedAt: true, article: { select: { archivedAt: true } } } },
        },
      });
      if (!item) throw new ItemsError(NOT_FOUND);
      if ((item.archivedAt !== null) === archived) throw new NoChange();
      if (isItemArchived({ archivedAt: null, subarticle: item.subarticle })) {
        throw new ItemsError("Подстатья или статья в архиве — сначала верните её");
      }
      // Вернувшаяся строка встаёт в конец действующих.
      const last = archived
        ? null
        : await tx.budgetItem.aggregate({ where: { subarticleId: item.subarticleId, archivedAt: null }, _max: { sortOrder: true } });
      await tx.budgetItem.update({
        where: { id },
        data: archived ? { archivedAt } : { archivedAt, sortOrder: (last?._max.sortOrder ?? -1) + 1 },
      });
      name = item.name;
      what = "строка";
    }
    return { entityId: id, summary: `${what} «${name}» ${archived ? "убрана в архив" : "возвращена из архива"}` };
  });
  return done(projectId, departmentId, outcome, archived ? "Убрано в архив" : "Возвращено");
}

// ---------------------------------------------------------------------------
// Импорт из Excel в статьи
// ---------------------------------------------------------------------------

type SubForLine = { id: string; number: number; article: { templateArticle: { number: number } } };

/**
 * Номер и код новой строки из счётчика подстатьи; код с таким номером уже занят (например,
 * вписан вручную в старой таблице) — берётся следующий номер.
 */
async function allocateLine(tx: Tx, projectId: string, access: Access, sub: SubForLine) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { lastLineNumber: number } = await tx.budgetSubarticle.update({
      where: { id: sub.id },
      data: { lastLineNumber: { increment: 1 } },
      select: { lastLineNumber: true },
    });
    const code = lineCode(access.budget.codePrefix, sub.article.templateArticle.number, sub.number, number);
    const taken = await tx.budgetItem.findUnique({ where: { projectId_code: { projectId, code } }, select: { id: true } });
    if (!taken) return { number, code };
  }
  throw new ItemsError("Не удалось выдать номер строки — попробуйте ещё раз");
}

export type ImportSheet = { name: string; rows: string[][] };

/** Предел ответа чтения файла: ячеек и знаков на все листы вместе (одна общая строка Excel может стоять в каждой ячейке). */
const IMPORT_READ_CELLS = IMPORT_LIMITS.cells;
const IMPORT_READ_CHARS = 4_000_000;

/** Значение ячейки Excel строкой: числа — с точкой и без «хвостов» плавающей точки. */
function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(Number(value.toFixed(6))) : "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as { result?: unknown; richText?: { text: string }[]; text?: unknown };
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return cellText(v.result);
    if (typeof v.text === "string") return v.text;
  }
  return "";
}

/**
 * Импорт, шаг 1: прочитать файл .xlsx и отдать листы (значения ячеек строками) — для выбора
 * листа, колонок и предпросмотра. В базу ничего не пишет. Только глава этого цеха. Пустые строки
 * и колонки в конце листа отбрасываются; на все листы вместе — предел ячеек и знаков.
 */
export async function readItemsImportFileAction(
  projectId: string,
  departmentId: string,
  formData: FormData,
): Promise<{ error: string } | { sheets: ImportSheet[] }> {
  const access = await editorAccess(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Файл не получен" };
  if (/\.xls$/i.test(file.name)) return { error: "Старый формат .xls не поддерживается — сохраните файл как .xlsx" };
  if (!/\.xlsx$/i.test(file.name)) return { error: "Нужен файл Excel в формате .xlsx" };
  if (file.size > IMPORT_LIMITS.fileBytes) return { error: "Файл больше 3,5 МБ — такой не импортируется" };
  const tooBig = "В файле слишком много данных — оставьте в нём только нужный лист со сметой";
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    checkZipLimits(buffer);
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheets: ImportSheet[] = [];
    let cells = 0;
    let chars = 0;
    for (const sheet of workbook.worksheets.slice(0, IMPORT_LIMITS.sheetsPerImport)) {
      const rows: string[][] = [];
      const last = Math.min(sheet.rowCount, IMPORT_MAX_ROWS + 50);
      const width = Math.min(sheet.columnCount, IMPORT_MAX_COLUMNS);
      for (let r = 1; r <= last; r++) {
        const row = sheet.getRow(r);
        const values = Array.from({ length: width }, (_, c) => cellText(row.getCell(c + 1).value).slice(0, 500));
        while (values.length > 0 && values[values.length - 1] === "") values.pop();
        cells += values.length;
        chars += values.reduce((s, v) => s + v.length, 0);
        if (cells > IMPORT_READ_CELLS || chars > IMPORT_READ_CHARS) return { error: tooBig };
        rows.push(values);
      }
      while (rows.length > 0 && rows[rows.length - 1].length === 0) rows.pop();
      sheets.push({ name: sheet.name, rows });
    }
    if (sheets.length === 0) return { error: "В файле нет листов" };
    return { sheets };
  } catch (error) {
    if (error instanceof ImportError) return { error: error.message };
    console.error("[readItemsImportFile]", error);
    return { error: "Не удалось прочитать файл — проверьте, что это .xlsx" };
  }
}

const importSchema = z.object({
  fileName: z.string().max(260).optional(),
  fields: z.array(z.enum(IMPORT_FIELD_IDS as unknown as [ImportFieldId, ...ImportFieldId[]])).max(20),
  rows: z
    .array(
      z.object({
        row: z.number().int().min(1).max(1_000_000),
        values: z.record(z.string(), z.string().max(500)),
      }),
    )
    .max(IMPORT_MAX_ROWS),
  target: z
    .union([
      z.object({ subarticleId: z.string().min(1).max(64) }),
      z.object({ articleId: z.string().min(1).max(64), newSubarticleName: z.string().max(200) }),
    ])
    .nullable(),
  dryRun: z.boolean(),
});

type ImportPayload = z.infer<typeof importSchema>;

export type ImportItemsResult = {
  error?: string;
  /** Ошибки по строкам листа — ничего не загружено. */
  errors?: { row: number; message: string }[];
  success?: string;
  created?: number;
  updated?: number;
  unchanged?: number;
  revision?: number;
};

type PreparedRow = { row: number; itemId: string | null; input: LineInput; taxPercent: string | null; same: boolean };

type Prepared = {
  errors: { row: number; message: string }[];
  prepared: PreparedRow[];
  values: VariableValues;
};

type ImportDb = Pick<
  Tx,
  "budgetItem" | "budgetSubarticle" | "budgetArticle" | "project" | "projectFinanceVariable" | "projectExpenseType" | "projectPaymentForm"
>;

/**
 * Проверка и сборка строк импорта по текущему состоянию сметы: для записи — внутри транзакции
 * под блокировкой сметы, чтобы поля, которых нет в листе, взялись у строки как они есть сейчас.
 * Проверяет и назначение новых строк, и предел суммы строки — «Проверить» видит то же, что запись.
 */
async function prepareImport(db: ImportDb, projectId: string, access: Access, data: ImportPayload): Promise<Prepared> {
  const fields = new Set(data.fields);
  const [variables, expenseTypes, paymentForms, existing] = await Promise.all([
    loadBudgetVariables(projectId, db),
    db.projectExpenseType.findMany({ where: { projectId, archivedAt: null }, select: { id: true, name: true } }),
    db.projectPaymentForm.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, name: true, defaultTaxPercent: true },
    }),
    db.budgetItem.findMany({
      where: { projectId, subarticle: { article: { budgetId: access.budget.id } } },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        quantity: true,
        rate: true,
        expenseTypeId: true,
        paymentFormId: true,
        taxPercent: true,
        multiplier1VariableId: true,
        multiplier1Value: true,
        multiplier2VariableId: true,
        multiplier2Value: true,
        multiplier3VariableId: true,
        multiplier3Value: true,
        archivedAt: true,
        subarticle: { select: { archivedAt: true, article: { select: { archivedAt: true } } } },
      },
    }),
  ]);
  const values = variableValueMap(variables);
  const byName = (list: { id: string; name: string }[]) => new Map(list.map((x) => [x.name.trim().toLowerCase(), x.id]));
  const typeIds = byName(expenseTypes);
  const formIds = byName(paymentForms);
  const formTax = new Map(paymentForms.map((f) => [f.id, f.defaultTaxPercent?.toString() ?? null]));
  const byCode = new Map(existing.map((i) => [i.code.toUpperCase(), i]));
  const decimal = (d: Prisma.Decimal | null) => d?.toString() ?? null;

  const errors: { row: number; message: string }[] = [];
  const prepared: PreparedRow[] = [];
  const seenCodes = new Set<string>();
  for (const r of data.rows) {
    const v = r.values as Partial<Record<ImportFieldId, string>>;
    const fail = (message: string) => errors.push({ row: r.row, message });
    const code = fields.has("code") ? v.code?.trim().toUpperCase() || undefined : undefined;
    const item = code ? byCode.get(code) : undefined;
    if (code) {
      if (seenCodes.has(code)) {
        fail(`Код ${code} встречается в листе второй раз`);
        continue;
      }
      seenCodes.add(code);
      if (!item) {
        fail(`Код ${code} не найден в этой смете — уберите код, чтобы добавить строку как новую`);
        continue;
      }
      if (isItemArchived(item)) {
        fail(`Строка с кодом ${code} в архиве — сначала верните её`);
        continue;
      }
    }
    // Поле загружается — значение из листа (пусто — пусто); не загружается — прежнее у строки.
    const take = (field: ImportFieldId, current: string | null) => (fields.has(field) ? (v[field] ?? null) : current);

    let expenseTypeId = item?.expenseTypeId ?? null;
    if (fields.has("expenseType")) {
      const name = v.expenseType?.trim();
      expenseTypeId = name ? (typeIds.get(name.toLowerCase()) ?? null) : null;
      if (name && !expenseTypeId) {
        fail(`Тип расхода «${name}» не найден в настройках финансов`);
        continue;
      }
    }
    let paymentFormId = item?.paymentFormId ?? null;
    if (fields.has("paymentForm")) {
      const name = v.paymentForm?.trim();
      paymentFormId = name ? (formIds.get(name.toLowerCase()) ?? null) : null;
      if (name && !paymentFormId) {
        fail(`Форма оплаты «${name}» не найдена в настройках финансов`);
        continue;
      }
    }
    let multipliers: unknown[] = item
      ? multipliersOf(item).map((m) => (m == null ? null : "variableId" in m ? m : { value: m.value.toString() }))
      : [null, null, null];
    if (fields.has("multipliers")) {
      const m = parseMultipliersText(v.multipliers?.trim() ?? "", variables);
      if (!m.ok) {
        fail(m.error);
        continue;
      }
      multipliers = m.value;
    }
    // Налог %: колонка есть — из неё; нет, но форма оплаты пришла и сменилась (или строка новая) —
    // процент формы; иначе прежний.
    const formChanged = fields.has("paymentForm") && paymentFormId !== (item?.paymentFormId ?? null);
    const taxFromForm = !fields.has("taxPercent") && (formChanged || (!item && fields.has("paymentForm")));
    const line = parseLineInput({
      name: take("name", item?.name ?? null) ?? "",
      unit: take("unit", item?.unit ?? null),
      quantity: take("quantity", decimal(item?.quantity ?? null)),
      rate: take("rate", decimal(item?.rate ?? null)),
      multipliers,
      expenseTypeId,
      paymentFormId,
      ...(taxFromForm ? {} : { taxPercent: take("taxPercent", decimal(item?.taxPercent ?? null)) ?? "" }),
    });
    if (!line.ok) {
      fail(line.error);
      continue;
    }
    const taxPercent = taxFromForm
      ? (paymentFormId ? (formTax.get(paymentFormId) ?? null) : null)
      : (line.value.taxPercent ?? null);
    const calc = calcItem({ quantity: line.value.quantity, rate: line.value.rate, multipliers: line.value.multipliers, taxPercent }, values);
    if (calc.total && calc.total.greaterThan(MAX_LINE_MONEY)) {
      fail("Сумма строки слишком большая — проверьте количество, ставку и множители");
      continue;
    }
    prepared.push({
      row: r.row,
      itemId: item?.id ?? null,
      input: { ...line.value, taxPercent },
      taxPercent,
      same: Boolean(item) && sameLine(item!, { ...line.value, taxPercent }),
    });
  }

  // Назначение новых строк — та же проверка, что при записи.
  if (prepared.some((p) => !p.itemId)) {
    const target = data.target;
    if (!target) errors.push({ row: 0, message: "Выберите подстатью для новых строк" });
    else if ("subarticleId" in target) {
      const sub = isId(target.subarticleId)
        ? await db.budgetSubarticle.findFirst({
            where: { id: target.subarticleId, projectId, article: { budgetId: access.budget.id } },
            select: { archivedAt: true, article: { select: { archivedAt: true } } },
          })
        : null;
      if (!sub) errors.push({ row: 0, message: "Подстатья для новых строк не найдена" });
      else if (sub.archivedAt || sub.article.archivedAt) errors.push({ row: 0, message: "Подстатья в архиве — сначала верните её" });
    } else {
      const article = isId(target.articleId)
        ? await db.budgetArticle.findFirst({
            where: { id: target.articleId, projectId, budgetId: access.budget.id },
            select: { archivedAt: true },
          })
        : null;
      const name = parseName(target.newSubarticleName, 200);
      if (!article) errors.push({ row: 0, message: "Статья для новой подстатьи не найдена" });
      else if (article.archivedAt) errors.push({ row: 0, message: "Статья в архиве — сначала верните её" });
      if (!name.ok) errors.push({ row: 0, message: `Название новой подстатьи: ${name.error.toLowerCase()}` });
    }
  }
  return { errors, prepared, values };
}

function importCounts(prepared: PreparedRow[]) {
  return {
    created: prepared.filter((p) => !p.itemId).length,
    updated: prepared.filter((p) => p.itemId && !p.same).length,
    unchanged: prepared.filter((p) => p.same).length,
  };
}

/** Ошибка внутри транзакции импорта: строки сметы изменились, пока шёл импорт. */
class ImportChanged extends ItemsError {}

/**
 * Импорт, шаг 2: строки листа (уже разложенные по полям) → проверка каждой строки → запись
 * одной транзакцией. Строка с кодом из этой сметы обновляет ту строку (только загружаемые поля),
 * без кода — новая строка в выбранной подстатье. Хоть одна ошибка — не пишется ничего, ошибки —
 * по номерам строк. `dryRun` — только проверка. Только глава этого цеха.
 */
export async function importItemsAction(
  projectId: string,
  departmentId: string,
  payload: unknown,
): Promise<ImportItemsResult> {
  const access = await editorAccess(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  const parsed = importSchema.safeParse(payload);
  if (!parsed.success) return { error: "Некорректные данные" };
  const data = parsed.data;
  const fields = new Set(data.fields);
  if (data.rows.length === 0) return { error: "В листе нет строк для загрузки" };
  if (!fields.has("name") && !fields.has("code")) return { error: "Сопоставьте колонку «Наименование» (или «Код»)" };

  const check = await prepareImport(prisma, projectId, access, data);
  if (check.errors.length > 0) return { errors: check.errors.slice(0, 200) };
  const counts = importCounts(check.prepared);
  if (data.dryRun) return { success: "Проверено — ошибок нет", ...counts };
  if (counts.created + counts.updated === 0) return { success: "Без изменений — всё уже как в листе", ...counts };

  const fileName = data.fileName?.trim() || "файл Excel";
  let outcome: Awaited<ReturnType<typeof editBudget>>;
  try {
    outcome = await editBudget(
      projectId,
      access,
      "UPDATE",
      async (tx) => {
        // Заново — под блокировкой сметы: поля, которых нет в листе, — как у строки сейчас.
        const { errors, prepared, values } = await prepareImport(tx, projectId, access, data);
        if (errors.length > 0) {
          throw new ImportChanged("Смета изменилась, пока шёл импорт, — нажмите «Проверить» ещё раз");
        }
        const done = importCounts(prepared);
        const newRows = prepared.filter((p) => !p.itemId);
        let sub: (SubForLine & { name: string }) | null = null;
        if (newRows.length > 0 && data.target) {
          const target = data.target;
          if ("subarticleId" in target) {
            sub = await subarticleOfBudget(tx, projectId, access.budget.id, target.subarticleId);
          } else {
            const article = await articleOfBudget(tx, projectId, access.budget.id, target.articleId);
            const name = parseName(target.newSubarticleName, 200);
            if (!name.ok) throw new ItemsError(name.error);
            const { lastSubarticleNumber: number } = await tx.budgetArticle.update({
              where: { id: article.id },
              data: { lastSubarticleNumber: { increment: 1 } },
              select: { lastSubarticleNumber: true },
            });
            const last = await tx.budgetSubarticle.aggregate({ where: { articleId: article.id }, _max: { sortOrder: true } });
            const created = await tx.budgetSubarticle.create({
              data: { projectId, articleId: article.id, number, name: name.value, sortOrder: (last._max.sortOrder ?? -1) + 1 },
              select: { id: true, number: true, name: true },
            });
            sub = { ...created, article: { templateArticle: { number: article.templateArticle.number } } };
          }
        }

        for (const p of prepared) {
          if (!p.itemId || p.same) continue;
          const { data: line } = await lineData(tx, projectId, p.input, p.taxPercent, values);
          await tx.budgetItem.update({ where: { id: p.itemId }, data: line });
        }
        if (sub) {
          const last = await tx.budgetItem.aggregate({ where: { subarticleId: sub.id }, _max: { sortOrder: true } });
          let sortOrder = (last._max.sortOrder ?? -1) + 1;
          for (const p of newRows) {
            const { number, code } = await allocateLine(tx, projectId, access, sub);
            const { data: line } = await lineData(tx, projectId, p.input, p.taxPercent, values);
            await tx.budgetItem.create({
              data: { projectId, departmentId: access.budget.departmentId, subarticleId: sub.id, number, code, sortOrder: sortOrder++, ...line },
              select: { id: true },
            });
          }
        }
        Object.assign(counts, done);
        return {
          entityId: access.budget.id,
          summary: `импорт из Excel «${fileName}»: добавлено строк — ${done.created}, обновлено — ${done.updated}${
            sub && done.created > 0 ? ` (новые — в подстатью «${sub.name}»)` : ""
          }`,
          changes: { import: { fileName, ...done } },
        };
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    // Не уложились во время транзакции — всё откатилось, данные не тронуты.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
      return { error: "Импорт не успел за отведённое время — ничего не загружено. Разбейте лист на части поменьше" };
    }
    throw error;
  }
  if ("error" in outcome) return { error: outcome.error };
  if ("unchanged" in outcome) return { success: "Без изменений", ...counts };
  revalidate(projectId, departmentId);
  return {
    success: `Загружено: добавлено строк — ${counts.created}, обновлено — ${counts.updated}`,
    ...counts,
    revision: outcome.revision,
  };
}
