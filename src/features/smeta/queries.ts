import "server-only";

import { BudgetStatus, Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";
import {
  assembleWorkbookFromSheets,
  splitWorkbookToSheets,
  type UniverWorkbookData,
} from "@/features/smeta/lib/workbook-model";
import { createDepartmentWorkbookSnapshot } from "@/features/smeta/lib/templates";
import {
  analyzeMainSheet,
  type MainSheetLike,
  type ParsedRow,
  type SmetaCheck,
} from "@/features/smeta/lib/main-sheet";

const budgetInclude = {
  sheets: {
    include: { data: true },
    orderBy: { sortOrder: "asc" as const },
  },
};

/** Id листа Univer: только такие ключи принимаются от браузера. */
const SHEET_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_SHEETS = 100;

type TransactionCallback = Extract<
  Parameters<typeof prisma.$transaction>[0],
  (client: never) => Promise<unknown>
>;
type Tx = TransactionCallback extends (client: infer T) => Promise<unknown> ? T : never;
/** Клиент базы или транзакция — для чтения статей и факта по ним. */
type Db = Pick<Tx, "budgetItem" | "accrual" | "cashPaymentBreakdown">;
export type { Tx };

function toClientBudget(row: {
  id: string;
  projectId: string;
  departmentId: string;
  mainSheetId: string | null;
  revision: number;
  name: string;
  styles: unknown;
  createdAt: Date;
  updatedAt: Date;
  sheets: {
    id: string;
    sheetKey: string;
    name: string;
    sortOrder: number;
    pinned: boolean;
    data: { data: unknown } | null;
  }[];
}) {
  // В браузер уходят только ключи листов Univer, серверные id листов остаются здесь.
  const workbook: UniverWorkbookData = assembleWorkbookFromSheets({
    budgetId: row.id,
    name: row.name,
    styles: row.styles,
    sheets: row.sheets.map((s) => ({
      id: s.sheetKey,
      name: s.name,
      sortOrder: s.sortOrder,
      data: s.data?.data ?? null,
    })),
  });

  return {
    id: row.id,
    departmentId: row.departmentId,
    name: row.name,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    mainSheetKey: row.sheets.find((s) => s.id === row.mainSheetId)?.sheetKey ?? null,
    workbook,
    sheetsMeta: row.sheets.map((s) => ({
      id: s.sheetKey,
      name: s.name,
      sortOrder: s.sortOrder,
      pinned: s.pinned,
    })),
  };
}

export type BudgetClient = ReturnType<typeof toClientBudget>;

export async function getDepartmentBudget(projectId: string, departmentId: string) {
  const row = await prisma.budget.findFirst({
    where: { projectId, departmentId },
    include: budgetInclude,
  });
  return row ? toClientBudget(row) : null;
}

export type DepartmentBudgetSummary = {
  revision: number;
  updatedAt: string;
  itemCount: number;
  total: number;
  status: BudgetStatus;
  /** Глава правил смету после отправки — она в списке продюсера с пометкой. */
  changedAfterSubmit: boolean;
  submittedAt: string | null;
  returnComment: string | null;
  lastVersionNumber: number | null;
};

/** Есть ли смета у цехов, сколько в ней статей и итог по ним. */
export async function listDepartmentBudgetSummaries(
  projectId: string,
  departmentIds: readonly string[],
): Promise<Map<string, DepartmentBudgetSummary>> {
  if (departmentIds.length === 0) return new Map();
  const [budgets, totals, versions] = await Promise.all([
    prisma.budget.findMany({
      where: { projectId, departmentId: { in: [...departmentIds] } },
      select: {
        departmentId: true,
        revision: true,
        updatedAt: true,
        status: true,
        changedAfterSubmitAt: true,
        submittedAt: true,
        returnComment: true,
      },
    }),
    prisma.budgetItem.groupBy({
      by: ["departmentId"],
      where: { projectId, departmentId: { in: [...departmentIds] }, archivedAt: null },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.budgetVersion.groupBy({
      by: ["departmentId"],
      where: { projectId, departmentId: { in: [...departmentIds] } },
      _max: { number: true },
    }),
  ]);
  const totalsById = new Map(totals.map((t) => [t.departmentId, t]));
  const lastVersionById = new Map(versions.map((v) => [v.departmentId, v._max.number]));
  return new Map(
    budgets.map((b) => {
      const t = totalsById.get(b.departmentId);
      return [
        b.departmentId,
        {
          revision: b.revision,
          updatedAt: b.updatedAt.toISOString(),
          itemCount: t?._count._all ?? 0,
          total: t?._sum.total ? Number(t._sum.total) : 0,
          status: b.status,
          changedAfterSubmit: b.changedAfterSubmitAt !== null,
          submittedAt: b.submittedAt?.toISOString() ?? null,
          returnComment: b.returnComment,
          lastVersionNumber: lastVersionById.get(b.departmentId) ?? null,
        },
      ];
    }),
  );
}

/** Все коды цеха, архивные тоже: автокод их не переиспользует. */
export async function listDepartmentCodes(projectId: string, departmentId: string) {
  const rows = await prisma.budgetItem.findMany({
    where: { projectId, departmentId },
    select: { code: true },
  });
  return rows.map((r) => r.code);
}

/** Создать книгу цеха из встроенного шаблона. Если книга уже есть — вернуть её id. */
export async function createDepartmentBudget(
  projectId: string,
  departmentId: string,
  name: string,
  createdById: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.budget.findFirst({
    where: { projectId, departmentId },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const { workbook, mainSheetKey } = createDepartmentWorkbookSnapshot(name);
  const split = splitWorkbookToSheets(workbook);

  try {
    const id = await prisma.$transaction(async (tx) => {
      const budget = await tx.budget.create({
        data: {
          projectId,
          departmentId,
          name: split.name,
          styles: split.styles as Prisma.InputJsonValue,
          createdById,
          sheets: {
            create: split.sheets.map((s) => ({
              sheetKey: s.id,
              name: s.name,
              sortOrder: s.sortOrder,
              data: { create: { data: s.data as Prisma.InputJsonValue } },
            })),
          },
        },
        select: { id: true, sheets: { select: { id: true, sheetKey: true } } },
      });
      const main = budget.sheets.find((s) => s.sheetKey === mainSheetKey);
      await tx.budget.update({
        where: { id: budget.id },
        data: { mainSheetId: main?.id ?? null },
      });
      return budget.id;
    });
    return { id, created: true };
  } catch (error) {
    // Вторую книгу цеха не даёт уникальный ключ — значит, её только что создали.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await prisma.budget.findFirst({
        where: { projectId, departmentId },
        select: { id: true },
      });
      if (again) return { id: again.id, created: false };
    }
    throw error;
  }
}

/** Коды, которые уже принадлежат статьям других цехов проекта (активным или архивным). */
async function codesOfOtherDepartments(
  db: Db,
  projectId: string,
  departmentId: string,
  codes: readonly string[],
) {
  if (codes.length === 0) return new Map<string, string>();
  const rows = await db.budgetItem.findMany({
    where: { projectId, code: { in: [...codes] }, departmentId: { not: departmentId } },
    select: { code: true, department: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.code, r.department.name]));
}

type ItemFact = { code: string; name: string; archived: boolean; accrued: number; paid: number };

/** Статьи цеха (действующие и архивные), по которым есть начисления или платежи. */
async function departmentFacts(
  db: Db,
  projectId: string,
  departmentId: string,
): Promise<Map<string, ItemFact>> {
  const accrued = await db.accrual.groupBy({
    by: ["budgetItemId"],
    where: { projectId, budgetItem: { departmentId } },
    _sum: { amountWithTax: true },
  });
  const paid = await db.cashPaymentBreakdown.groupBy({
    by: ["budgetItemId"],
    where: { budgetItem: { projectId, departmentId } },
    _sum: { amount: true },
  });
  const sums = new Map<string, { accrued: number; paid: number }>();
  for (const a of accrued) {
    if (!a.budgetItemId) continue;
    sums.set(a.budgetItemId, { accrued: Number(a._sum.amountWithTax ?? 0), paid: 0 });
  }
  for (const p of paid) {
    if (!p.budgetItemId) continue;
    const s = sums.get(p.budgetItemId) ?? { accrued: 0, paid: 0 };
    s.paid = Number(p._sum.amount ?? 0);
    sums.set(p.budgetItemId, s);
  }
  for (const [id, s] of sums) if (s.accrued === 0 && s.paid === 0) sums.delete(id);
  if (sums.size === 0) return new Map();

  const items = await db.budgetItem.findMany({
    where: { id: { in: [...sums.keys()] } },
    select: { id: true, code: true, name: true, archivedAt: true },
  });
  return new Map(
    items.map((i) => [
      i.code,
      { code: i.code, name: i.name, archived: i.archivedAt !== null, ...sums.get(i.id)! },
    ]),
  );
}

function factText(f: ItemFact) {
  const rub = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
  return [f.accrued ? `начислено ${rub(f.accrued)}` : "", f.paid ? `оплачено ${rub(f.paid)}` : ""]
    .filter(Boolean)
    .join(", ");
}

/** Разбор основного листа + проверка дублей по проекту и факта по статьям. Ничего не пишет. */
export async function analyzeWithProject(
  db: Db,
  projectId: string,
  departmentId: string,
  mainSheet: MainSheetLike | null,
) {
  if (!mainSheet) {
    const checks: SmetaCheck[] = [
      { kind: "headers", row: 0, message: "Основной лист не найден. Статьи не обновляются." },
    ];
    return { broken: true, items: [] as ParsedRow[], checks, factCodes: new Set<string>() };
  }
  const analysis = analyzeMainSheet(mainSheet);
  const taken = await codesOfOtherDepartments(
    db,
    projectId,
    departmentId,
    analysis.items.map((i) => i.code),
  );
  const checks = [...analysis.checks];
  const items = analysis.items.filter((item) => {
    const owner = taken.get(item.code);
    if (!owner) return true;
    checks.push({
      kind: "duplicate",
      row: item.row,
      message: `Строка ${item.row + 1}: код ${item.code} уже занят в смете цеха «${owner}» — строка не учитывается.`,
    });
    return false;
  });

  const facts = analysis.broken
    ? new Map<string, ItemFact>()
    : await departmentFacts(db, projectId, departmentId);
  const rowByCode = new Map(items.map((i) => [i.code, i.row]));
  for (const fact of facts.values()) {
    const row = rowByCode.get(fact.code);
    if (row === undefined) {
      checks.push({
        kind: "gone_with_fact",
        row: 0,
        message: `Код ${fact.code} («${fact.name}») нет на основном листе, а по нему ${factText(fact)} — в плане/факте он будет «вне плана».`,
      });
    } else if (fact.archived) {
      checks.push({
        kind: "restored_with_fact",
        row,
        message: `Строка ${row + 1}: код ${fact.code} возвращается из архива — по нему уже ${factText(fact)}.`,
      });
    }
  }

  checks.sort((a, b) => a.row - b.row);
  return { broken: analysis.broken, items, checks, factCodes: new Set(facts.keys()) };
}

/** Проверки сохранённой сметы — для показа при открытии страницы. */
export async function checkDepartmentBudget(projectId: string, budget: BudgetClient) {
  const main = budget.mainSheetKey ? budget.workbook.sheets[budget.mainSheetKey] : null;
  const result = await analyzeWithProject(prisma, projectId, budget.departmentId, main ?? null);
  return result.checks;
}

function dec(n: number | null): Prisma.Decimal | null {
  return n === null ? null : new Prisma.Decimal(n);
}

function same(a: Prisma.Decimal | null, b: number | null, places: number) {
  if (a === null || b === null) return a === null && b === null;
  return a.toFixed(places) === new Prisma.Decimal(b).toFixed(places);
}

export type ItemChanges = {
  added: string[];
  archived: string[];
  restored: string[];
  /** Из `restored` — те, по которым уже есть начисления или платежи */
  restoredWithFact: string[];
  changed: { code: string; name?: [string, string]; total?: [string, string] }[];
};

function hasChanges(c: ItemChanges) {
  return c.added.length + c.archived.length + c.restored.length + c.changed.length > 0;
}

/** Статьи цеха по разобранным строкам: новые, изменённые, ушедшие в архив, вернувшиеся. */
async function syncItems(
  tx: Tx,
  projectId: string,
  departmentId: string,
  rows: ParsedRow[],
  factCodes: ReadonlySet<string>,
): Promise<ItemChanges> {
  const existing = await tx.budgetItem.findMany({ where: { projectId, departmentId } });
  const byCode = new Map(existing.map((i) => [i.code, i]));
  const changes: ItemChanges = {
    added: [],
    archived: [],
    restored: [],
    restoredWithFact: [],
    changed: [],
  };
  const seen = new Set<string>();

  for (const row of rows) {
    seen.add(row.code);
    const values = {
      name: row.name,
      unit: row.unit,
      quantity: dec(row.quantity),
      rate: dec(row.rate),
      days: dec(row.days),
      amount: new Prisma.Decimal(row.amount),
      taxPercent: dec(row.taxPercent),
      tax: new Prisma.Decimal(row.tax),
      total: new Prisma.Decimal(row.total),
      sortOrder: row.row,
      archivedAt: null,
    };
    const item = byCode.get(row.code);
    if (!item) {
      await tx.budgetItem.create({
        data: { projectId, departmentId, code: row.code, ...values },
      });
      changes.added.push(row.code);
      continue;
    }

    const sameValues =
      item.name === row.name &&
      item.unit === row.unit &&
      same(item.quantity, row.quantity, 4) &&
      same(item.rate, row.rate, 2) &&
      same(item.days, row.days, 4) &&
      same(item.taxPercent, row.taxPercent, 4) &&
      same(item.amount, row.amount, 2) &&
      same(item.tax, row.tax, 2) &&
      same(item.total, row.total, 2);
    if (sameValues && item.sortOrder === row.row && item.archivedAt === null) continue;

    await tx.budgetItem.update({ where: { id: item.id }, data: values });
    if (item.archivedAt !== null) {
      changes.restored.push(row.code);
      if (factCodes.has(row.code)) changes.restoredWithFact.push(row.code);
    } else if (!sameValues) {
      const entry: ItemChanges["changed"][number] = { code: row.code };
      if (item.name !== row.name) entry.name = [item.name, row.name];
      if (!same(item.total, row.total, 2)) {
        entry.total = [item.total.toFixed(2), new Prisma.Decimal(row.total).toFixed(2)];
      }
      changes.changed.push(entry);
    }
  }

  const gone = existing.filter((i) => i.archivedAt === null && !seen.has(i.code));
  if (gone.length > 0) {
    await tx.budgetItem.updateMany({
      where: { id: { in: gone.map((i) => i.id) } },
      data: { archivedAt: new Date() },
    });
    changes.archived.push(...gone.map((i) => i.code));
  }
  return changes;
}

/** Заблокировать строку сметы до конца транзакции: сохранение, отправка, утверждение и
 * возврат одной сметы идут строго по очереди. */
export async function lockBudget(tx: Tx, budgetId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${budgetId} FOR UPDATE`;
}

/** JSON с ключами по алфавиту: база (jsonb) порядок ключей не хранит. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Пришедшая книга совпадает с сохранённой: те же листы, порядок, данные и стили. */
function sameWorkbook(
  stored: {
    styles: unknown;
    sheets: { sheetKey: string; name: string; sortOrder: number; data: { data: unknown } | null }[];
  },
  incoming: ReturnType<typeof splitWorkbookToSheets>,
) {
  if (stored.sheets.length !== incoming.sheets.length) return false;
  if (stableJson(stored.styles) !== stableJson(incoming.styles)) return false;
  const byKey = new Map(stored.sheets.map((s) => [s.sheetKey, s]));
  return incoming.sheets.every((sheet) => {
    const old = byKey.get(sheet.id);
    return (
      !!old &&
      old.name === sheet.name &&
      old.sortOrder === sheet.sortOrder &&
      stableJson(old.data?.data ?? null) === stableJson(sheet.data)
    );
  });
}

/**
 * Что сохранение сделало со статусом: правка во время утверждения возвращает смету в
 * «черновик» (и она остаётся в списке продюсера), правка утверждённой — тоже в «черновик».
 */
export type SaveStatusChange = "changed_after_submit" | "draft_after_approve" | null;

export type PersistResult =
  | { error: "not_found" | "bad_sheets" | "not_draft" }
  | {
      error?: undefined;
      updatedAt: string;
      revision: number;
      checks: SmetaCheck[];
      changes: ItemChanges | null;
      budgetId: string;
      status: BudgetStatus;
      statusChange: SaveStatusChange;
    };

/**
 * Сохранить книгу цеха и разобрать основной лист в статьи.
 * Листы ищутся только по паре «эта книга + ключ листа»: лист другой книги так не найти,
 * чужой ключ просто станет новым листом этой книги. Основной лист не удаляется никогда.
 * Книга не изменилась (холостое автосохранение) — ничего не пишется, ревизия и статус те же.
 * Сохраняется только черновик: книга с другим id (например, просмотр версии) — отказ.
 */
export async function persistDepartmentBudget(
  projectId: string,
  departmentId: string,
  snapshot: Record<string, unknown>,
): Promise<PersistResult> {
  const found = await prisma.budget.findFirst({
    where: { projectId, departmentId },
    select: { id: true },
  });
  if (!found) return { error: "not_found" };
  if (snapshot.id !== found.id) return { error: "not_draft" };

  const split = splitWorkbookToSheets(snapshot);
  const keys = split.sheets.map((s) => s.id);
  if (
    keys.length === 0 ||
    keys.length > MAX_SHEETS ||
    new Set(keys).size !== keys.length ||
    keys.some((k) => !SHEET_KEY.test(k))
  ) {
    return { error: "bad_sheets" };
  }

  return prisma.$transaction(
    async (tx) => {
      await lockBudget(tx, found.id);
      const budget = await tx.budget.findUniqueOrThrow({
        where: { id: found.id },
        select: {
          id: true,
          mainSheetId: true,
          status: true,
          revision: true,
          updatedAt: true,
          styles: true,
          sheets: {
            select: {
              id: true,
              sheetKey: true,
              name: true,
              sortOrder: true,
              data: { select: { data: true } },
            },
          },
        },
      });

      const existingByKey = new Map(budget.sheets.map((s) => [s.sheetKey, s.id]));
      const mainKey = budget.sheets.find((s) => s.id === budget.mainSheetId)?.sheetKey ?? null;
      const incoming = new Set(keys);
      const obsoleteIds = budget.sheets
        .filter((s) => !incoming.has(s.sheetKey) && s.id !== budget.mainSheetId)
        .map((s) => s.id);
      const mainSheet = mainKey ? split.sheets.find((s) => s.id === mainKey) : undefined;

      const analysis = await analyzeWithProject(
        tx,
        projectId,
        departmentId,
        mainSheet?.data ?? null,
      );

      if (sameWorkbook(budget, split)) {
        return {
          budgetId: budget.id,
          updatedAt: budget.updatedAt.toISOString(),
          revision: budget.revision,
          checks: analysis.checks,
          changes: null,
          status: budget.status,
          statusChange: null,
        };
      }

      if (obsoleteIds.length) {
        await tx.budgetSheet.deleteMany({
          where: { budgetId: budget.id, id: { in: obsoleteIds } },
        });
      }

      for (const sheet of split.sheets) {
        const data = sheet.data as Prisma.InputJsonValue;
        const sheetId = existingByKey.get(sheet.id);
        if (sheetId) {
          await tx.budgetSheet.update({
            where: { id: sheetId, budgetId: budget.id },
            data: {
              name: sheet.name,
              sortOrder: sheet.sortOrder,
              data: { upsert: { create: { data }, update: { data } } },
            },
          });
        } else {
          await tx.budgetSheet.create({
            data: {
              budgetId: budget.id,
              sheetKey: sheet.id,
              name: sheet.name,
              sortOrder: sheet.sortOrder,
              data: { create: { data } },
            },
          });
        }
      }

      // Сломанные заголовки или нет основного листа — статьи остаются как были.
      const changes = analysis.broken
        ? null
        : await syncItems(tx, projectId, departmentId, analysis.items, analysis.factCodes);

      const statusChange: SaveStatusChange =
        budget.status === BudgetStatus.SUBMITTED
          ? "changed_after_submit"
          : budget.status === BudgetStatus.APPROVED
            ? "draft_after_approve"
            : null;

      const saved = await tx.budget.update({
        where: { id: budget.id },
        data: {
          styles: split.styles as Prisma.InputJsonValue,
          revision: { increment: 1 },
          ...(statusChange === "changed_after_submit"
            ? { status: BudgetStatus.DRAFT, changedAfterSubmitAt: new Date() }
            : statusChange === "draft_after_approve"
              ? { status: BudgetStatus.DRAFT }
              : {}),
        },
        select: { updatedAt: true, revision: true, status: true },
      });

      return {
        budgetId: budget.id,
        updatedAt: saved.updatedAt.toISOString(),
        revision: saved.revision,
        checks: analysis.checks,
        changes: changes && hasChanges(changes) ? changes : null,
        status: saved.status,
        statusChange,
      };
    },
    { timeout: 20_000 },
  );
}

export async function setBudgetSheetPinned(
  projectId: string,
  departmentId: string,
  sheetKey: string,
  pinned: boolean,
) {
  const updated = await prisma.budgetSheet.updateMany({
    where: { sheetKey, budget: { projectId, departmentId } },
    data: { pinned },
  });
  return updated.count > 0 ? { sheetKey, pinned } : null;
}
