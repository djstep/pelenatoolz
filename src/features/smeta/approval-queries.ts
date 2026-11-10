import "server-only";

import { createHash } from "node:crypto";
import { BudgetStatus, BudgetVersionFormat, Prisma } from "@prisma/client";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation, type AuditContext } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";
import { loadBudgetVariables } from "@/features/smeta/items-queries";
import { lockBudget, type BudgetClient, type Tx } from "@/features/smeta/queries";
import { diffBudget, withoutCodes, type BudgetDiff, type DiffSource } from "@/features/smeta/lib/budget-diff";
import {
  buildItemsSnapshot,
  changedVariables,
  parseItemsSnapshot,
  snapshotDiffSources,
  snapshotStructureKey,
  snapshotVariableIds,
  type ItemsSnapshot,
  type SnapshotVariable,
  type VariableChange,
} from "@/features/smeta/lib/items-snapshot";
import { assembleWorkbookFromSheets, type UniverWorksheetData } from "@/features/smeta/lib/workbook-model";

/**
 * Утверждение смет цехов по статьям: отправка главой, утверждение и возврат продюсером, версии.
 * Все переходы — в транзакции под блокировкой строки сметы (`lockBudget`), запись журнала —
 * в той же транзакции. Продюсер утверждает ровно то, что видел: экран сравнения отдаёт отпечаток
 * снимка (строки и значения переменных), утверждение сверяет его заново.
 */

type Db = Pick<
  Tx,
  "budget" | "budgetArticle" | "budgetVersion" | "project" | "projectFinanceVariable"
>;

// ---------------------------------------------------------------------------
// Снимок черновика и версии
// ---------------------------------------------------------------------------

/** Снимок действующих статей, подстатей и строк сметы по действующим значениям переменных. */
export async function loadItemsSnapshot(db: Db, projectId: string, budgetId: string): Promise<ItemsSnapshot> {
  const [variables, articles, budget] = await Promise.all([
    loadBudgetVariables(projectId, db),
    db.budgetArticle.findMany({
      where: { projectId, budgetId, archivedAt: null },
      orderBy: [{ templateArticle: { sortOrder: "asc" } }, { templateArticle: { number: "asc" } }],
      select: {
        id: true,
        templateArticleId: true,
        templateArticle: { select: { name: true, number: true } },
        subarticles: {
          where: { archivedAt: null },
          orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
          select: {
            id: true,
            number: true,
            name: true,
            items: {
              where: { archivedAt: null },
              orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
              select: {
                id: true,
                code: true,
                name: true,
                unit: true,
                quantity: true,
                rate: true,
                taxPercent: true,
                expenseTypeId: true,
                paymentFormId: true,
                expenseType: { select: { name: true } },
                paymentForm: { select: { name: true } },
                multiplier1VariableId: true,
                multiplier1Value: true,
                multiplier2VariableId: true,
                multiplier2Value: true,
                multiplier3VariableId: true,
                multiplier3Value: true,
              },
            },
          },
        },
      },
    }),
    db.budget.findUnique({ where: { id: budgetId }, select: { department: { select: { codePrefix: true } } } }),
  ]);
  // Коды статей и подстатей — как у строк (lineCode): префикс цеха и номера уровней.
  const prefix = budget?.department.codePrefix ?? "";
  const two = (n: number) => String(n).padStart(2, "0");
  return buildItemsSnapshot(
    articles.map((a) => ({
      id: a.id,
      code: `${prefix}-${two(a.templateArticle.number)}`,
      templateArticleId: a.templateArticleId,
      name: a.templateArticle.name,
      subarticles: a.subarticles.map((s) => ({
        id: s.id,
        code: `${prefix}-${two(a.templateArticle.number)}.${two(s.number)}`,
        name: s.name,
        items: s.items.map(({ expenseType, paymentForm, ...item }) => ({
          ...item,
          expenseType: expenseType?.name ?? null,
          paymentForm: paymentForm?.name ?? null,
        })),
      })),
    })),
    variables,
  );
}

/** Отпечаток снимка: тот же снимок — тот же отпечаток. */
export function snapshotFingerprint(snapshot: ItemsSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

const versionLineSelect = {
  budgetItemId: true,
  code: true,
  name: true,
  unit: true,
  quantity: true,
  rate: true,
  days: true,
  amount: true,
  taxPercent: true,
  tax: true,
  total: true,
  sortOrder: true,
} as const;

type VersionLineRow = Prisma.BudgetVersionLineGetPayload<{ select: typeof versionLineSelect }>;

function num(d: Prisma.Decimal | null): number | null {
  return d === null ? null : Number(d);
}

/** Строка старой версии (табличный формат) для сравнения. */
function sheetLineSource(row: VersionLineRow): DiffSource {
  return {
    itemId: row.budgetItemId,
    code: row.code,
    name: row.name,
    unit: row.unit,
    quantity: num(row.quantity),
    rate: num(row.rate),
    days: num(row.days),
    amount: Number(row.amount),
    taxPercent: num(row.taxPercent),
    tax: Number(row.tax),
    total: Number(row.total),
    sortOrder: row.sortOrder,
  };
}

type VersionForDiff = { format: BudgetVersionFormat; snapshot: Prisma.JsonValue; lines: VersionLineRow[] };

/** Строки версии для сравнения: снимок новой сметы или строки старой. */
export function versionSources(v: VersionForDiff): DiffSource[] {
  if (v.format === BudgetVersionFormat.ITEMS) {
    const snapshot = parseItemsSnapshot(v.snapshot);
    return snapshot ? snapshotDiffSources(snapshot) : [];
  }
  return v.lines.map(sheetLineSource);
}

export async function lastVersion(db: Pick<Tx, "budgetVersion">, projectId: string, departmentId: string) {
  return db.budgetVersion.findFirst({
    where: { projectId, departmentId },
    orderBy: { number: "desc" },
    select: {
      number: true,
      approvedAt: true,
      approvedByName: true,
      format: true,
      snapshot: true,
      lines: { select: versionLineSelect, orderBy: { sortOrder: "asc" } },
    },
  });
}

/** Сколько строк без суммы мешает отправке и утверждению — словами. */
function incompleteError(snapshot: ItemsSnapshot): string | null {
  const n = snapshot.totals.incomplete;
  if (n === 0) return null;
  const word = n % 10 === 1 && n % 100 !== 11 ? "строка" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "строки" : "строк";
  return `В смете ${n} ${word} без суммы (не задана переменная или нет кол-ва и ставки) — заполните их или уберите в архив`;
}

// ---------------------------------------------------------------------------
// Отправка, утверждение, возврат
// ---------------------------------------------------------------------------

type Fail = { ok: false; error: string };

const NOT_FOUND: Fail = { ok: false, error: "Смета не найдена" };

async function lockedBudget(tx: Tx, projectId: string, departmentId: string) {
  const found = await tx.budget.findFirst({
    where: { projectId, departmentId },
    select: { id: true, department: { select: { name: true } } },
  });
  if (!found) return null;
  await lockBudget(tx, found.id);
  return { id: found.id, departmentName: found.department.name };
}

/** Отправить смету на утверждение (глава). */
export async function submitBudget(
  ctx: AuditContext,
  input: { projectId: string; departmentId: string; revision: number; comment: string | null },
): Promise<Fail | { ok: true }> {
  const { projectId, departmentId } = input;
  return prisma.$transaction(
    async (tx) => {
      const locked = await lockedBudget(tx, projectId, departmentId);
      if (!locked) return NOT_FOUND;
      const budget = await tx.budget.findUniqueOrThrow({
        where: { id: locked.id },
        select: { status: true, revision: true },
      });
      if (budget.status === BudgetStatus.SUBMITTED) return { ok: false, error: "Смета уже на утверждении" } as const;
      if (budget.status === BudgetStatus.APPROVED) {
        return { ok: false, error: "Смета утверждена, изменений после утверждения нет — отправлять нечего" } as const;
      }
      if (budget.revision !== input.revision) {
        return { ok: false, error: "Смета ещё сохраняется или изменилась — подождите сохранения и отправьте снова" } as const;
      }

      const snapshot = await loadItemsSnapshot(tx, projectId, locked.id);
      if (snapshot.lineCount === 0) return { ok: false, error: "В смете нет строк — отправлять нечего" } as const;
      const incomplete = incompleteError(snapshot);
      if (incomplete) return { ok: false, error: incomplete } as const;
      const last = await lastVersion(tx, projectId, departmentId);
      if (last && diffBudget(versionSources(last), snapshotDiffSources(snapshot)).empty) {
        return { ok: false, error: `Отличий от утверждённой версии ${last.number} нет — отправлять нечего` } as const;
      }

      await auditMutation(
        ctx,
        () =>
          tx.budget.update({
            where: { id: locked.id },
            data: {
              status: BudgetStatus.SUBMITTED,
              submittedAt: new Date(),
              submittedById: ctx.user.id,
              submitComment: input.comment,
              submittedRevision: budget.revision,
              changedAfterSubmitAt: null,
            },
          }),
        undefined,
        {
          projectId,
          entityType: AuditEntityType.budget,
          entityId: locked.id,
          action: "UPDATE",
          summary: `Смета цеха «${locked.departmentName}» отправлена на утверждение`,
          changes: {
            revision: budget.revision,
            comment: input.comment,
            itemCount: snapshot.lineCount,
            total: snapshot.totals.total,
          },
        },
        { db: tx },
      );
      return { ok: true } as const;
    },
    { timeout: 20_000 },
  );
}

/**
 * Неизменяемая версия из снимка и статус «утверждена» — общее для утверждения отправленной
 * сметы и пересчёта по переменным. Вызывать под блокировкой сметы.
 */
async function createItemsVersion(
  tx: Tx,
  ctx: AuditContext,
  input: {
    projectId: string;
    departmentId: string;
    budgetId: string;
    departmentName: string;
    revision: number;
    snapshot: ItemsSnapshot;
    approvedByHead: boolean;
    submitted: { byId: string | null; byName: string | null; at: Date | null; comment: string | null };
    /** Пересчёт по переменным: какие переменные изменились. */
    recalc: VariableChange[] | null;
  },
): Promise<number> {
  const { projectId, departmentId, snapshot } = input;
  const approver = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { name: true } });
  const last = await tx.budgetVersion.findFirst({
    where: { projectId, departmentId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const number = (last?.number ?? 0) + 1;
  // Строки плана — точными Decimal из строк снимка (не через число JS).
  const lines = snapshot.articles.flatMap((a) => a.subarticles.flatMap((s) => s.lines));
  const dec = (v: string | null) => (v == null ? null : new Prisma.Decimal(v));
  const recalcText = input.recalc
    ? ` — пересчёт по переменным (${input.recalc.map((c) => `${c.label} ${c.before ?? "не задана"} → ${c.after ?? "не задана"}`).join(", ")})`
    : "";

  await auditMutation(
    ctx,
    () =>
      tx.budgetVersion.create({
        data: {
          projectId,
          departmentId,
          budgetId: input.budgetId,
          number,
          revision: input.revision,
          approvedById: ctx.user.id,
          approvedByName: approver.name,
          approvedByHead: input.approvedByHead,
          submittedById: input.submitted.byId,
          submittedByName: input.submitted.byName,
          submittedAt: input.submitted.at,
          submitComment: input.submitted.comment,
          total: new Prisma.Decimal(snapshot.totals.total),
          itemCount: snapshot.lineCount,
          format: BudgetVersionFormat.ITEMS,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          recalcByVariables: input.recalc !== null,
          // Строки версии — план цеха для плана/факта (по id строки).
          lines: {
            create: lines.map((l, index) => ({
              budgetItemId: l.id,
              code: l.code,
              name: l.name,
              unit: l.unit,
              quantity: dec(l.quantity),
              rate: dec(l.rate),
              days: null,
              // Строки без суммы до утверждения не доходят (проверка у вызывающего).
              amount: dec(l.amount) ?? new Prisma.Decimal(0),
              taxPercent: dec(l.taxPercent),
              tax: dec(l.tax) ?? new Prisma.Decimal(0),
              total: dec(l.total) ?? new Prisma.Decimal(0),
              sortOrder: index,
            })),
          },
        },
        select: { id: true },
      }),
    undefined,
    {
      projectId,
      entityType: AuditEntityType.budgetVersion,
      action: "CREATE",
      entityId: (_input, r) => r.id,
      summary: `Смета цеха «${input.departmentName}»: утверждена версия ${number}${input.approvedByHead ? " (утвердил глава цеха)" : ""}${recalcText}`,
      changes: {
        number,
        total: snapshot.totals.total,
        itemCount: snapshot.lineCount,
        approvedByHead: input.approvedByHead,
        recalcByVariables: input.recalc !== null,
        variables: Object.fromEntries(snapshot.variables.map((v) => [v.label, v.value])),
      },
    },
    { db: tx },
  );

  await tx.budget.update({
    where: { id: input.budgetId },
    data: {
      status: BudgetStatus.APPROVED,
      submittedAt: null,
      submittedById: null,
      submitComment: null,
      submittedRevision: null,
      changedAfterSubmitAt: null,
    },
  });
  return number;
}

/** Утвердить смету (продюсер): неизменяемая версия ровно из того снимка, который он видел. */
export async function approveBudget(
  ctx: AuditContext,
  input: { projectId: string; departmentId: string; fingerprint: string; approvedByHead: boolean },
): Promise<Fail | { ok: true; number: number }> {
  const { projectId, departmentId } = input;
  return prisma.$transaction(
    async (tx) => {
      const locked = await lockedBudget(tx, projectId, departmentId);
      if (!locked) return NOT_FOUND;
      const budget = await tx.budget.findUniqueOrThrow({
        where: { id: locked.id },
        select: {
          status: true,
          revision: true,
          changedAfterSubmitAt: true,
          submittedAt: true,
          submittedById: true,
          submitComment: true,
          submittedBy: { select: { name: true } },
        },
      });
      if (budget.status !== BudgetStatus.SUBMITTED) {
        return {
          ok: false,
          error: budget.changedAfterSubmitAt
            ? "Смету изменили после отправки — утвердить можно после повторной отправки"
            : "Смета не на утверждении",
        } as const;
      }

      const snapshot = await loadItemsSnapshot(tx, projectId, locked.id);
      if (snapshotFingerprint(snapshot) !== input.fingerprint) {
        return {
          ok: false,
          error: "Смета или значения переменных изменились после того, как вы её открыли — обновите страницу",
        } as const;
      }
      if (snapshot.lineCount === 0) return { ok: false, error: "В смете нет строк" } as const;
      const incomplete = incompleteError(snapshot);
      if (incomplete) return { ok: false, error: incomplete } as const;

      const number = await createItemsVersion(tx, ctx, {
        projectId,
        departmentId,
        budgetId: locked.id,
        departmentName: locked.departmentName,
        revision: budget.revision,
        snapshot,
        approvedByHead: input.approvedByHead,
        submitted: {
          byId: budget.submittedById,
          byName: budget.submittedBy?.name ?? null,
          at: budget.submittedAt,
          comment: budget.submitComment,
        },
        recalc: null,
      });
      return { ok: true, number } as const;
    },
    { timeout: 20_000 },
  );
}

/** Вернуть смету главе с комментарием (продюсер). */
export async function returnBudget(
  ctx: AuditContext,
  input: { projectId: string; departmentId: string; comment: string },
): Promise<Fail | { ok: true }> {
  const { projectId, departmentId } = input;
  return prisma.$transaction(async (tx) => {
    const locked = await lockedBudget(tx, projectId, departmentId);
    if (!locked) return NOT_FOUND;
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: locked.id },
      select: { status: true, changedAfterSubmitAt: true },
    });
    if (budget.status !== BudgetStatus.SUBMITTED && !budget.changedAfterSubmitAt) {
      return { ok: false, error: "Смета не на утверждении" } as const;
    }
    await auditMutation(
      ctx,
      () =>
        tx.budget.update({
          where: { id: locked.id },
          data: {
            status: BudgetStatus.RETURNED,
            returnedAt: new Date(),
            returnedById: ctx.user.id,
            returnComment: input.comment,
            submittedAt: null,
            submittedById: null,
            submitComment: null,
            submittedRevision: null,
            changedAfterSubmitAt: null,
          },
        }),
      undefined,
      {
        projectId,
        entityType: AuditEntityType.budget,
        entityId: locked.id,
        action: "UPDATE",
        summary: `Смета цеха «${locked.departmentName}» возвращена главе`,
        changes: { comment: input.comment },
      },
      { db: tx },
    );
    return { ok: true } as const;
  });
}

// ---------------------------------------------------------------------------
// Пересчёт по переменным: продюсер утверждает сам, без отправки главой
// ---------------------------------------------------------------------------

type RecalcCandidate = {
  budgetId: string;
  departmentName: string;
  revision: number;
  snapshot: ItemsSnapshot;
  fingerprint: string;
  versionNumber: number;
  changes: VariableChange[];
  totalBefore: string;
};

/**
 * Смета ушла в черновик только из-за смены переменных: последняя версия — по статьям, строки
 * с тех пор не менялись (то же строение без учёта значений переменных), изменились суммы,
 * строк без суммы нет. Если глава что-то правил — пересчёт сам не утверждается.
 */
async function recalcCandidate(tx: Tx, projectId: string, departmentId: string): Promise<RecalcCandidate | null> {
  const budget = await tx.budget.findFirst({
    where: { projectId, departmentId },
    select: { id: true, status: true, revision: true, changedAfterSubmitAt: true, department: { select: { name: true } } },
  });
  if (!budget || budget.status !== BudgetStatus.DRAFT || budget.changedAfterSubmitAt) return null;
  const last = await lastVersion(tx, projectId, departmentId);
  if (!last || last.format !== BudgetVersionFormat.ITEMS) return null;
  const approved = parseItemsSnapshot(last.snapshot);
  if (!approved) return null;
  const draft = await loadItemsSnapshot(tx, projectId, budget.id);
  if (draft.totals.incomplete > 0 || draft.lineCount === 0) return null;
  if (snapshotStructureKey(draft) !== snapshotStructureKey(approved)) return null;
  const changes = variableChangesOf(last, draft.variables, draft);
  if (changes.length === 0) return null;
  return {
    budgetId: budget.id,
    departmentName: budget.department.name,
    revision: budget.revision,
    snapshot: draft,
    fingerprint: snapshotFingerprint(draft),
    versionNumber: last.number,
    changes,
    totalBefore: approved.totals.total,
  };
}

export type RecalcCandidateInfo = {
  departmentId: string;
  departmentName: string;
  versionNumber: number;
  fingerprint: string;
  changes: VariableChange[];
  totalBefore: string;
  totalAfter: string;
};

/** Сметы, которые продюсер может утвердить как пересчёт по переменным, — для списка и сводной. */
export async function listRecalcCandidates(projectId: string, departmentIds: readonly string[]): Promise<RecalcCandidateInfo[]> {
  if (departmentIds.length === 0) return [];
  return prisma.$transaction(
    async (tx) => {
      // Кандидаты — только черновики с версией по статьям: остальные не читаем.
      const drafts = await tx.budget.findMany({
        where: { projectId, departmentId: { in: [...departmentIds] }, status: BudgetStatus.DRAFT, changedAfterSubmitAt: null },
        select: { departmentId: true },
      });
      const out: RecalcCandidateInfo[] = [];
      for (const { departmentId } of drafts) {
        const c = await recalcCandidate(tx, projectId, departmentId);
        if (!c) continue;
        out.push({
          departmentId,
          departmentName: c.departmentName,
          versionNumber: c.versionNumber,
          fingerprint: c.fingerprint,
          changes: c.changes,
          totalBefore: c.totalBefore,
          totalAfter: c.snapshot.totals.total,
        });
      }
      return out.sort((a, b) => a.departmentName.localeCompare(b.departmentName, "ru"));
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 },
  );
}

/**
 * Утвердить пересчёт по переменным (продюсер): новая версия с пометкой «пересчёт по переменным»
 * ровно из того черновика, который он видел (отпечаток). Глава что-то менял — отказ: обычный
 * порядок через отправку.
 */
export async function approveVariableRecalc(
  ctx: AuditContext,
  input: { projectId: string; departmentId: string; fingerprint: string },
): Promise<Fail | { ok: true; number: number }> {
  const { projectId, departmentId } = input;
  return prisma.$transaction(
    async (tx) => {
      const locked = await lockedBudget(tx, projectId, departmentId);
      if (!locked) return NOT_FOUND;
      const candidate = await recalcCandidate(tx, projectId, departmentId);
      if (!candidate) {
        return {
          ok: false,
          error: "Это не пересчёт по переменным: смету меняли или она не в черновике — утверждение через отправку главой",
        } as const;
      }
      if (candidate.fingerprint !== input.fingerprint) {
        return { ok: false, error: "Смета или значения переменных изменились — обновите страницу" } as const;
      }
      const number = await createItemsVersion(tx, ctx, {
        projectId,
        departmentId,
        budgetId: locked.id,
        departmentName: locked.departmentName,
        revision: candidate.revision,
        snapshot: candidate.snapshot,
        approvedByHead: false,
        submitted: { byId: null, byName: null, at: null, comment: null },
        recalc: candidate.changes,
      });
      return { ok: true, number } as const;
    },
    { timeout: 20_000 },
  );
}

// ---------------------------------------------------------------------------
// Чтение: статус, сравнение, версии
// ---------------------------------------------------------------------------

const approvalSelect = {
  id: true,
  status: true,
  revision: true,
  submittedAt: true,
  submitComment: true,
  submittedBy: { select: { name: true } },
  changedAfterSubmitAt: true,
  returnedAt: true,
  returnComment: true,
  returnedBy: { select: { name: true } },
} as const;

export type BudgetApprovalInfo = {
  status: BudgetStatus;
  revision: number;
  submittedAt: string | null;
  submittedByName: string | null;
  submitComment: string | null;
  changedAfterSubmitAt: string | null;
  returnedAt: string | null;
  returnedByName: string | null;
  returnComment: string | null;
  lastVersion: { number: number; approvedAt: string; approvedByName: string } | null;
};

function toApprovalInfo(
  budget: Prisma.BudgetGetPayload<{ select: typeof approvalSelect }>,
  last: { number: number; approvedAt: Date; approvedByName: string } | null,
): BudgetApprovalInfo {
  return {
    status: budget.status,
    revision: budget.revision,
    submittedAt: budget.submittedAt?.toISOString() ?? null,
    submittedByName: budget.submittedBy?.name ?? null,
    submitComment: budget.submitComment,
    changedAfterSubmitAt: budget.changedAfterSubmitAt?.toISOString() ?? null,
    returnedAt: budget.returnedAt?.toISOString() ?? null,
    returnedByName: budget.returnedBy?.name ?? null,
    returnComment: budget.returnComment,
    lastVersion: last
      ? { number: last.number, approvedAt: last.approvedAt.toISOString(), approvedByName: last.approvedByName }
      : null,
  };
}

/** Статус сметы для шапки. */
export async function getBudgetApprovalInfo(projectId: string, departmentId: string) {
  const budget = await prisma.budget.findFirst({ where: { projectId, departmentId }, select: approvalSelect });
  if (!budget) return null;
  const last = await prisma.budgetVersion.findFirst({
    where: { projectId, departmentId },
    orderBy: { number: "desc" },
    select: { number: true, approvedAt: true, approvedByName: true },
  });
  return toApprovalInfo(budget, last);
}

/**
 * Пометка «изменилась после утверждения»: переменные в строках утверждённой версии или
 * черновика, у которых значение сейчас другое, чем при утверждении.
 */
function variableChangesOf(last: VersionForDiff | null, current: readonly SnapshotVariable[], draft: ItemsSnapshot): VariableChange[] {
  if (!last || last.format !== BudgetVersionFormat.ITEMS) return [];
  const approved = parseItemsSnapshot(last.snapshot);
  if (!approved) return [];
  const used = new Set([...snapshotVariableIds(approved), ...snapshotVariableIds(draft)]);
  return changedVariables(approved.variables, current, used);
}

/** Переменные, изменившиеся после утверждения, — для плашки на экране сметы цеха. */
export async function getVariableChangesSinceApproval(projectId: string, departmentId: string): Promise<VariableChange[]> {
  return prisma.$transaction(
    async (tx) => {
      const budget = await tx.budget.findFirst({ where: { projectId, departmentId }, select: { id: true } });
      if (!budget) return [];
      const last = await lastVersion(tx, projectId, departmentId);
      if (!last || last.format !== BudgetVersionFormat.ITEMS) return [];
      const draft = await loadItemsSnapshot(tx, projectId, budget.id);
      return variableChangesOf(last, draft.variables, draft);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 },
  );
}

/**
 * Экран сравнения: статус, разница «последняя версия ↔ черновик» и отпечаток черновика —
 * одним снимком базы (RepeatableRead), чтобы утверждался ровно показанный черновик.
 */
export async function getBudgetReview(projectId: string, departmentId: string) {
  return prisma.$transaction(
    async (tx) => {
      const budget = await tx.budget.findFirst({ where: { projectId, departmentId }, select: approvalSelect });
      if (!budget) return null;
      const [last, draft] = await Promise.all([
        lastVersion(tx, projectId, departmentId),
        loadItemsSnapshot(tx, projectId, budget.id),
      ]);
      const diff = withoutCodes(diffBudget(last ? versionSources(last) : [], snapshotDiffSources(draft)));
      return {
        info: toApprovalInfo(budget, last),
        diff,
        nextNumber: (last?.number ?? 0) + 1,
        fingerprint: snapshotFingerprint(draft),
        incomplete: draft.totals.incomplete,
        lineCount: draft.lineCount,
        variableChanges: variableChangesOf(last, draft.variables, draft),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20_000 },
  );
}

/** Версии цеха, новые сверху. */
export async function listDepartmentVersions(projectId: string, departmentId: string) {
  const rows = await prisma.budgetVersion.findMany({
    where: { projectId, departmentId },
    orderBy: { number: "desc" },
    select: {
      number: true,
      approvedAt: true,
      approvedByName: true,
      approvedByHead: true,
      submittedByName: true,
      submitComment: true,
      total: true,
      itemCount: true,
      format: true,
      recalcByVariables: true,
    },
  });
  return rows.map((r) => ({ ...r, approvedAt: r.approvedAt.toISOString(), total: Number(r.total) }));
}

export type VersionLine = DiffSource;

const versionSelect = {
  id: true,
  number: true,
  approvedAt: true,
  approvedByName: true,
  approvedByHead: true,
  submittedByName: true,
  submittedAt: true,
  submitComment: true,
  total: true,
  itemCount: true,
  format: true,
  recalcByVariables: true,
  snapshot: true,
  sheetName: true,
  sheetData: true,
  styles: true,
  lines: { select: versionLineSelect, orderBy: { sortOrder: "asc" } },
} as const;

type VersionMeta = {
  number: number;
  approvedAt: string;
  approvedByName: string;
  approvedByHead: boolean;
  submittedByName: string | null;
  submittedAt: string | null;
  submitComment: string | null;
  total: number;
  itemCount: number;
  /** Пересчёт по переменным: утвердил продюсер без отправки главой. */
  recalcByVariables: boolean;
};

export type DepartmentVersion =
  | (VersionMeta & { format: "ITEMS"; snapshot: ItemsSnapshot })
  | (VersionMeta & { format: "SHEET"; lines: DiffSource[]; sheetBook: BudgetClient });

/** Одна версия: снимок сметы по статьям или (старый формат) строки и лист только для показа. */
export async function getDepartmentVersion(
  projectId: string,
  departmentId: string,
  number: number,
): Promise<DepartmentVersion | null> {
  const v = await prisma.budgetVersion.findFirst({ where: { projectId, departmentId, number }, select: versionSelect });
  if (!v) return null;
  const meta: VersionMeta = {
    number: v.number,
    approvedAt: v.approvedAt.toISOString(),
    approvedByName: v.approvedByName,
    approvedByHead: v.approvedByHead,
    submittedByName: v.submittedByName,
    submittedAt: v.submittedAt?.toISOString() ?? null,
    submitComment: v.submitComment,
    total: Number(v.total),
    itemCount: v.itemCount,
    recalcByVariables: v.recalcByVariables,
  };
  if (v.format === BudgetVersionFormat.ITEMS) {
    const snapshot = parseItemsSnapshot(v.snapshot);
    if (!snapshot) return null;
    return { ...meta, format: "ITEMS", snapshot };
  }

  // Книга версии: id начинается с «version-» — сервер такую книгу никогда не сохраняет.
  const data = (v.sheetData ?? {}) as UniverWorksheetData;
  const sheetKey = typeof data.id === "string" && data.id ? data.id : "main";
  const workbookId = `version-${v.id}`;
  const workbook = assembleWorkbookFromSheets({
    budgetId: workbookId,
    name: `Версия ${v.number}`,
    styles: v.styles,
    sheets: [{ id: sheetKey, name: v.sheetName ?? "Смета", sortOrder: 0, data }],
  });
  const sheetBook: BudgetClient = {
    id: workbookId,
    departmentId,
    name: `Версия ${v.number}`,
    revision: 0,
    updatedAt: v.approvedAt.toISOString(),
    mainSheetKey: sheetKey,
    workbook,
    sheetsMeta: [{ id: sheetKey, name: v.sheetName ?? "Смета", sortOrder: 0, pinned: false }],
  };
  return { ...meta, format: "SHEET", lines: v.lines.map(sheetLineSource), sheetBook };
}

/** Сравнение двух версий цеха: что добавлено, удалено, изменено (по суммам и полям). */
export async function compareDepartmentVersions(
  projectId: string,
  departmentId: string,
  before: number,
  after: number,
): Promise<{ before: number; after: number; diff: BudgetDiff } | null> {
  const rows = await prisma.budgetVersion.findMany({
    where: { projectId, departmentId, number: { in: [before, after] } },
    select: { number: true, format: true, snapshot: true, lines: { select: versionLineSelect, orderBy: { sortOrder: "asc" } } },
  });
  const a = rows.find((r) => r.number === before);
  const b = rows.find((r) => r.number === after);
  if (!a || !b) return null;
  return { before, after, diff: withoutCodes(diffBudget(versionSources(a), versionSources(b))) };
}
