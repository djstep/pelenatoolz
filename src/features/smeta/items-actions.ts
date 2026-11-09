"use server";

import { Prisma, type AuditAction } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { assertInProject, isNotInProjectError } from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { loadBudgetVariables, variableValueMap } from "@/features/smeta/items-queries";
import { calcItem, MAX_LINE_MONEY } from "@/features/smeta/lib/item-calc";
import { isItemArchived } from "@/features/smeta/lib/item-where";
import { isId, lineCode, parseLineInput, parseName, type LineInput } from "@/features/smeta/lib/item-input";
import { canEditDepartmentSmeta } from "@/features/smeta/lib/smeta-access";
import { lockBudget, statusAfterEdit, type Tx } from "@/features/smeta/queries";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

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
      { timeout: 20_000 },
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
    select: { id: true, archivedAt: true, templateArticle: { select: { name: true } } },
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
async function lineData(tx: Tx, projectId: string, input: LineInput, taxPercent: string | null) {
  const values = variableValueMap(await loadBudgetVariables(projectId, tx));
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

    // Номер строки из счётчика подстатьи; код с таким номером уже занят (например, вписан
    // вручную в старой таблице) — берётся следующий номер.
    let number = 0;
    let code = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      ({ lastLineNumber: number } = await tx.budgetSubarticle.update({
        where: { id: sub.id },
        data: { lastLineNumber: { increment: 1 } },
        select: { lastLineNumber: true },
      }));
      code = lineCode(access.budget.codePrefix, sub.article.templateArticle.number, sub.number, number);
      const taken = await tx.budgetItem.findUnique({ where: { projectId_code: { projectId, code } }, select: { id: true } });
      if (!taken) break;
      code = "";
    }
    if (!code) throw new ItemsError("Не удалось выдать номер строки — попробуйте ещё раз");

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
