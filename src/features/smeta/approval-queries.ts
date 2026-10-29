import "server-only";

import { BudgetStatus, Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";
import {
  analyzeWithProject,
  lockBudget,
  type BudgetClient,
  type Tx,
} from "@/features/smeta/queries";
import { diffBudget, type DiffSource } from "@/features/smeta/lib/budget-diff";
import { freezeSheetFormulas } from "@/features/smeta/lib/version-snapshot";
import {
  assembleWorkbookFromSheets,
  type UniverWorksheetData,
} from "@/features/smeta/lib/workbook-model";
import {
  findMainColumns,
  type MainSheetLike,
  type SmetaCheck,
} from "@/features/smeta/lib/main-sheet";

/**
 * Утверждение смет цехов: отправка главой, утверждение и возврат продюсером, версии.
 * Все переходы — в транзакции под блокировкой строки сметы (`lockBudget`), как и сохранение:
 * они не перемешиваются, и продюсер утверждает ровно ту ревизию, которую видел.
 */

const lineSelect = {
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

type LineRow = {
  code: string;
  name: string;
  unit: string | null;
  quantity: Prisma.Decimal | null;
  rate: Prisma.Decimal | null;
  days: Prisma.Decimal | null;
  amount: Prisma.Decimal;
  taxPercent: Prisma.Decimal | null;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
  sortOrder: number;
};

function num(d: Prisma.Decimal | null): number | null {
  return d === null ? null : Number(d);
}

function toDiffSource(itemId: string, row: LineRow): DiffSource {
  return {
    itemId,
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

type Db = Pick<Tx, "budgetItem" | "budgetVersion">;

/** Активные статьи черновика и последняя утверждённая версия цеха (со строками). */
async function draftAndLastVersion(db: Db, projectId: string, departmentId: string) {
  const items = await db.budgetItem.findMany({
    where: { projectId, departmentId, archivedAt: null },
    select: { id: true, ...lineSelect },
    orderBy: { sortOrder: "asc" },
  });
  const version = await db.budgetVersion.findFirst({
    where: { projectId, departmentId },
    orderBy: { number: "desc" },
    select: {
      number: true,
      approvedAt: true,
      approvedByName: true,
      approvedByHead: true,
      lines: { select: { budgetItemId: true, ...lineSelect } },
    },
  });
  const diff = diffBudget(
    version?.lines.map((l) => toDiffSource(l.budgetItemId, l)) ?? [],
    items.map((i) => toDiffSource(i.id, i)),
  );
  return { items, version, diff };
}

type Fail = { ok: false; error: string };

const NOT_FOUND: Fail = { ok: false, error: "Смета не найдена" };

async function lockedBudgetId(tx: Tx, projectId: string, departmentId: string) {
  const found = await tx.budget.findFirst({
    where: { projectId, departmentId },
    select: { id: true },
  });
  if (!found) return null;
  await lockBudget(tx, found.id);
  return found.id;
}

/** Отправить смету на утверждение (глава). */
export async function submitBudget(input: {
  projectId: string;
  departmentId: string;
  userId: string;
  revision: number;
  comment: string | null;
}): Promise<Fail | { ok: true; budgetId: string; itemCount: number; total: number }> {
  const { projectId, departmentId } = input;
  return prisma.$transaction(
    async (tx) => {
      const budgetId = await lockedBudgetId(tx, projectId, departmentId);
      if (!budgetId) return NOT_FOUND;
      const budget = await tx.budget.findUniqueOrThrow({
        where: { id: budgetId },
        select: {
          status: true,
          revision: true,
          mainSheet: { select: { data: { select: { data: true } } } },
        },
      });
      if (budget.status === BudgetStatus.SUBMITTED) {
        return { ok: false, error: "Смета уже на утверждении" } as const;
      }
      if (budget.status === BudgetStatus.APPROVED) {
        return {
          ok: false,
          error: "Смета утверждена, изменений после утверждения нет — отправлять нечего",
        } as const;
      }
      if (budget.revision !== input.revision) {
        return {
          ok: false,
          error: "Смета ещё сохраняется или изменилась — подождите сохранения и отправьте снова",
        } as const;
      }

      const analysis = await analyzeWithProject(
        tx,
        projectId,
        departmentId,
        (budget.mainSheet?.data?.data as MainSheetLike | undefined) ?? null,
      );
      if (analysis.broken) {
        return {
          ok: false,
          error: "Заголовки основного листа повреждены — восстановите их перед отправкой",
        } as const;
      }

      const { items, version, diff } = await draftAndLastVersion(tx, projectId, departmentId);
      if (items.length === 0) {
        return { ok: false, error: "В смете нет статей — отправлять нечего" } as const;
      }
      if (version && diff.empty) {
        return {
          ok: false,
          error: `Отличий от утверждённой версии ${version.number} нет — отправлять нечего`,
        } as const;
      }

      await tx.budget.update({
        where: { id: budgetId },
        data: {
          status: BudgetStatus.SUBMITTED,
          submittedAt: new Date(),
          submittedById: input.userId,
          submitComment: input.comment,
          submittedRevision: budget.revision,
          changedAfterSubmitAt: null,
        },
      });
      return { ok: true, budgetId, itemCount: items.length, total: diff.totalAfter } as const;
    },
    { timeout: 20_000 },
  );
}

/** Утвердить смету (продюсер): создать неизменяемую версию из ревизии, которую он видел. */
export async function approveBudget(input: {
  projectId: string;
  departmentId: string;
  userId: string;
  revision: number;
  approvedByHead: boolean;
}): Promise<
  | Fail
  | { ok: true; budgetId: string; versionId: string; number: number; total: number; itemCount: number }
> {
  const { projectId, departmentId } = input;
  return prisma.$transaction(
    async (tx) => {
      const budgetId = await lockedBudgetId(tx, projectId, departmentId);
      if (!budgetId) return NOT_FOUND;
      const budget = await tx.budget.findUniqueOrThrow({
        where: { id: budgetId },
        select: {
          status: true,
          revision: true,
          changedAfterSubmitAt: true,
          submittedAt: true,
          submittedById: true,
          submitComment: true,
          submittedBy: { select: { name: true } },
          styles: true,
          mainSheet: { select: { name: true, data: { select: { data: true } } } },
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
      if (budget.revision !== input.revision) {
        return {
          ok: false,
          error: "Смету изменили после того, как вы её открыли — обновите страницу",
        } as const;
      }
      const sheetData = budget.mainSheet?.data?.data as MainSheetLike | undefined;
      if (!budget.mainSheet || !sheetData) {
        return { ok: false, error: "Основной лист сметы не найден" } as const;
      }
      const analysis = await analyzeWithProject(tx, projectId, departmentId, sheetData);
      if (analysis.broken) {
        return { ok: false, error: "Заголовки основного листа повреждены" } as const;
      }

      const { items, version: last } = await draftAndLastVersion(tx, projectId, departmentId);
      if (items.length === 0) return { ok: false, error: "В смете нет статей" } as const;

      const approver = await tx.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { name: true },
      });
      const total = items.reduce((sum, i) => sum.plus(i.total), new Prisma.Decimal(0));
      const number = (last?.number ?? 0) + 1;

      const version = await tx.budgetVersion.create({
        data: {
          projectId,
          departmentId,
          budgetId,
          number,
          revision: budget.revision,
          approvedById: input.userId,
          approvedByName: approver.name,
          approvedByHead: input.approvedByHead,
          submittedById: budget.submittedById,
          submittedByName: budget.submittedBy?.name ?? null,
          submittedAt: budget.submittedAt,
          submitComment: budget.submitComment,
          total,
          itemCount: items.length,
          sheetName: budget.mainSheet.name,
          // Картинка версии совпадает со строками: Сумма/Налог/Итого — серверный расчёт.
          sheetData: freezeSheetFormulas(
            sheetData,
            findMainColumns(sheetData).columns,
            items.map((i) => ({
              row: i.sortOrder,
              amount: Number(i.amount),
              tax: Number(i.tax),
              total: Number(i.total),
            })),
          ) as Prisma.InputJsonValue,
          styles: (budget.styles ?? {}) as Prisma.InputJsonValue,
          lines: {
            create: items.map(({ id, ...line }) => ({ budgetItemId: id, ...line })),
          },
        },
        select: { id: true },
      });

      await tx.budget.update({
        where: { id: budgetId },
        data: {
          status: BudgetStatus.APPROVED,
          submittedAt: null,
          submittedById: null,
          submitComment: null,
          submittedRevision: null,
          changedAfterSubmitAt: null,
        },
      });
      return {
        ok: true,
        budgetId,
        versionId: version.id,
        number,
        total: Number(total),
        itemCount: items.length,
      } as const;
    },
    { timeout: 20_000 },
  );
}

/** Вернуть смету главе с комментарием (продюсер). */
export async function returnBudget(input: {
  projectId: string;
  departmentId: string;
  userId: string;
  comment: string;
}): Promise<Fail | { ok: true; budgetId: string }> {
  const { projectId, departmentId } = input;
  return prisma.$transaction(async (tx) => {
    const budgetId = await lockedBudgetId(tx, projectId, departmentId);
    if (!budgetId) return NOT_FOUND;
    const budget = await tx.budget.findUniqueOrThrow({
      where: { id: budgetId },
      select: { status: true, changedAfterSubmitAt: true },
    });
    if (budget.status !== BudgetStatus.SUBMITTED && !budget.changedAfterSubmitAt) {
      return { ok: false, error: "Смета не на утверждении" } as const;
    }
    await tx.budget.update({
      where: { id: budgetId },
      data: {
        status: BudgetStatus.RETURNED,
        returnedAt: new Date(),
        returnedById: input.userId,
        returnComment: input.comment,
        submittedAt: null,
        submittedById: null,
        submitComment: null,
        submittedRevision: null,
        changedAfterSubmitAt: null,
      },
    });
    return { ok: true, budgetId } as const;
  });
}

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
  budget: {
    status: BudgetStatus;
    revision: number;
    submittedAt: Date | null;
    submitComment: string | null;
    submittedBy: { name: string } | null;
    changedAfterSubmitAt: Date | null;
    returnedAt: Date | null;
    returnComment: string | null;
    returnedBy: { name: string } | null;
  },
  lastVersion: { number: number; approvedAt: Date; approvedByName: string } | null,
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
    lastVersion: lastVersion
      ? {
          number: lastVersion.number,
          approvedAt: lastVersion.approvedAt.toISOString(),
          approvedByName: lastVersion.approvedByName,
        }
      : null,
  };
}

/** Статус сметы для шапки редактора. */
export async function getBudgetApprovalInfo(projectId: string, departmentId: string) {
  const budget = await prisma.budget.findFirst({
    where: { projectId, departmentId },
    select: approvalSelect,
  });
  if (!budget) return null;
  const last = await prisma.budgetVersion.findFirst({
    where: { projectId, departmentId },
    orderBy: { number: "desc" },
    select: { number: true, approvedAt: true, approvedByName: true },
  });
  return toApprovalInfo(budget, last);
}

/**
 * Экран сравнения: статус, ревизия и разница «последняя версия ↔ черновик» — одним снимком
 * базы (RepeatableRead), чтобы показанная разница точно соответствовала ревизии.
 */
export async function getBudgetReview(projectId: string, departmentId: string) {
  return prisma.$transaction(
    async (tx) => {
      const budget = await tx.budget.findFirst({
        where: { projectId, departmentId },
        select: {
          ...approvalSelect,
          mainSheet: { select: { data: { select: { data: true } } } },
        },
      });
      if (!budget) return null;
      const { version, diff } = await draftAndLastVersion(tx, projectId, departmentId);
      // «Вручную X, по расчёту Y»: в план идёт расчёт, продюсер должен это видеть.
      const analysis = await analyzeWithProject(
        tx,
        projectId,
        departmentId,
        (budget.mainSheet?.data?.data as MainSheetLike | undefined) ?? null,
      );
      const sheetDiffers: SmetaCheck[] = analysis.checks.filter(
        (c) => c.kind === "sheet_differs",
      );
      return {
        info: toApprovalInfo(budget, version),
        diff,
        nextNumber: (version?.number ?? 0) + 1,
        sheetDiffers,
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
    },
  });
  return rows.map((r) => ({
    ...r,
    approvedAt: r.approvedAt.toISOString(),
    total: Number(r.total),
  }));
}

export type VersionLine = DiffSource;

/** Одна версия: строки и снимок листа как книга Univer только для показа. */
export async function getDepartmentVersion(
  projectId: string,
  departmentId: string,
  number: number,
) {
  const v = await prisma.budgetVersion.findFirst({
    where: { projectId, departmentId, number },
    select: {
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
      sheetName: true,
      sheetData: true,
      styles: true,
      lines: { select: { budgetItemId: true, ...lineSelect }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!v) return null;

  // Книга версии: id начинается с «version-» — сервер такую книгу никогда не сохраняет.
  const data = (v.sheetData ?? {}) as UniverWorksheetData;
  const sheetKey = typeof data.id === "string" && data.id ? data.id : "main";
  const workbookId = `version-${v.id}`;
  const workbook = assembleWorkbookFromSheets({
    budgetId: workbookId,
    name: `Версия ${v.number}`,
    styles: v.styles,
    sheets: [{ id: sheetKey, name: v.sheetName, sortOrder: 0, data }],
  });
  const sheetBook: BudgetClient = {
    id: workbookId,
    departmentId,
    name: `Версия ${v.number}`,
    revision: 0,
    updatedAt: v.approvedAt.toISOString(),
    mainSheetKey: sheetKey,
    workbook,
    sheetsMeta: [{ id: sheetKey, name: v.sheetName, sortOrder: 0, pinned: false }],
  };

  return {
    number: v.number,
    approvedAt: v.approvedAt.toISOString(),
    approvedByName: v.approvedByName,
    approvedByHead: v.approvedByHead,
    submittedByName: v.submittedByName,
    submittedAt: v.submittedAt?.toISOString() ?? null,
    submitComment: v.submitComment,
    total: Number(v.total),
    itemCount: v.itemCount,
    lines: v.lines.map((l) => toDiffSource(l.budgetItemId, l)),
    sheetBook,
  };
}
