import "server-only";

import { listDepartmentsForSmeta } from "@/features/departments/queries";
import { freezeSheetFormulas } from "@/features/smeta/lib/version-snapshot";
import {
  assembleWorkbookFromSheets,
  createDefaultWorksheet,
  type UniverWorkbookData,
} from "@/features/smeta/lib/workbook-model";
import type { SmetaAccessContext } from "@/features/smeta/lib/smeta-access";
import { getPlanFact } from "@/features/smeta/plan-fact-queries";
import { planFactNumbers, type PlanFactNumbers } from "@/features/smeta/lib/plan-fact";
import { prisma } from "@/shared/db/prisma";

type Cell = Record<string, unknown>;
type CellData = Record<string, Record<string, Cell | null | undefined> | undefined>;

export const SUMMARY_SHEET_KEY = "svod";
const STYLE_HEADER = "svodHeader";
const STYLE_MONEY = "svodMoney";
const STYLE_TOTAL = "svodTotal";
const STYLE_TOTAL_MONEY = "svodTotalMoney";
const MONEY_PATTERN = "#,##0.00";

const SUMMARY_STYLES = {
  [STYLE_HEADER]: { bl: 1, bg: { rgb: "#EEF0F3" }, vt: 2 },
  [STYLE_MONEY]: { n: { pattern: MONEY_PATTERN } },
  [STYLE_TOTAL]: { bl: 1 },
  [STYLE_TOTAL_MONEY]: { bl: 1, n: { pattern: MONEY_PATTERN } },
};

export type SummaryRow = {
  departmentName: string;
  versionNumber: number | null;
  /** Итог черновика (действующие статьи) — только при «показать черновики». */
  draftTotal: number | null;
  numbers: PlanFactNumbers;
};

export type SummaryBook = {
  workbook: UniverWorkbookData;
  sheetsMeta: { id: string; name: string; sortOrder: number; pinned: boolean }[];
  rows: SummaryRow[];
  unassigned: PlanFactNumbers | null;
  project: PlanFactNumbers;
  drafts: boolean;
};

/** Имя листа, годное и для Univer, и для Excel: без []:*?/\, до 31 знака, без повторов. */
function sheetName(raw: string, taken: Set<string>) {
  const base = raw.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Цех";
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

/** Стили книги цеха получают свой префикс, ссылки ячеек, строк и колонок — тоже. */
function prefixStyles(
  sheet: Record<string, unknown>,
  styles: unknown,
  prefix: string,
  into: Record<string, unknown>,
) {
  if (styles && typeof styles === "object") {
    for (const [key, value] of Object.entries(styles as Record<string, unknown>)) {
      into[`${prefix}${key}`] = value;
    }
  }
  const rename = (holder: unknown) => {
    if (holder && typeof holder === "object" && typeof (holder as Cell).s === "string") {
      (holder as Cell).s = `${prefix}${(holder as Cell).s as string}`;
    }
  };
  for (const line of Object.values((sheet.cellData ?? {}) as CellData)) {
    for (const cell of Object.values(line ?? {})) rename(cell);
  }
  for (const key of ["rowData", "columnData"] as const) {
    const map = sheet[key];
    if (map && typeof map === "object") for (const v of Object.values(map)) rename(v);
  }
  return sheet;
}

/** Пустой лист Univer со всеми обязательными полями — основа листов, собранных на сервере. */
function blankSheet() {
  return { ...createDefaultWorksheet("blank"), cellData: {}, columnData: {}, rowData: {} };
}

function placeholderSheet(text: string) {
  return {
    ...blankSheet(),
    rowCount: 20,
    columnCount: 6,
    cellData: { 0: { 0: { v: text, t: 1 } } },
    columnData: { 0: { w: 360 } },
    mergeData: [],
  };
}

function summarySheet(
  rows: SummaryRow[],
  unassigned: PlanFactNumbers | null,
  project: PlanFactNumbers,
  drafts: boolean,
) {
  const headers = ["Цех", "Версия", "План", "Начислено", "Оплачено", "Остаток"];
  if (drafts) headers.push("Черновик");
  const cells: CellData = { 0: {} };
  headers.forEach((h, i) => (cells[0]![i] = { v: h, t: 1, s: STYLE_HEADER }));

  const put = (
    r: number,
    label: string,
    version: string,
    n: PlanFactNumbers,
    draft: number | null,
    total = false,
  ) => {
    const text = total ? STYLE_TOTAL : undefined;
    const money = total ? STYLE_TOTAL_MONEY : STYLE_MONEY;
    const line: Record<string, Cell> = {
      0: { v: label, t: 1, ...(text ? { s: text } : {}) },
      1: { v: version, t: 1 },
      2: { v: n.plan, t: 2, s: money },
      3: { v: n.accrued, t: 2, s: money },
      4: { v: n.paid, t: 2, s: money },
      5: { v: n.remaining, t: 2, s: money },
    };
    if (drafts && draft !== null) line[6] = { v: draft, t: 2, s: money };
    cells[r] = line;
  };

  let r = 1;
  for (const row of rows) {
    const version = row.versionNumber ? `v${row.versionNumber}` : "нет";
    put(r++, row.departmentName, version, row.numbers, row.draftTotal);
  }
  if (unassigned) put(r++, "Без статьи", "", unassigned, null);
  const draftSum = drafts
    ? Math.round(rows.reduce((s, x) => s + (x.draftTotal ?? 0), 0) * 100) / 100
    : null;
  put(r++, "Итого", "", project, draftSum, true);

  const widths = [220, 70, 130, 130, 130, 130, 130];
  return {
    ...blankSheet(),
    rowCount: Math.max(r + 10, 30),
    columnCount: headers.length + 2,
    freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: -1 },
    cellData: cells,
    columnData: Object.fromEntries(widths.slice(0, headers.length).map((w, i) => [i, { w }])),
    mergeData: [],
  };
}

/**
 * Сводная книга продюсера (только чтение): «Свод» и лист на каждый цех — снимок последней
 * утверждённой версии или, с `drafts`, основной лист черновика (формулы заменены значениями,
 * сохранёнными в книге). Цифры «Свода» — тот же расчёт, что в плане/факте за всё время.
 * Права (продюсер или «Сметы — просмотр всех») проверяет вызывающий.
 */
export async function getSummaryBook(
  projectId: string,
  access: SmetaAccessContext,
  opts: { drafts: boolean },
): Promise<SummaryBook> {
  const departments = await listDepartmentsForSmeta(projectId, null);
  const ids = departments.map((d) => d.id);
  const [planFact, versions, budgets, draftTotals] = await Promise.all([
    getPlanFact(
      projectId,
      access,
      { departmentId: null, dateFrom: null, dateTo: null },
      departments,
    ),
    opts.drafts || ids.length === 0
      ? Promise.resolve([])
      : prisma.budgetVersion.findMany({
          where: { projectId, departmentId: { in: ids } },
          orderBy: [{ departmentId: "asc" }, { number: "desc" }],
          distinct: ["departmentId"],
          select: { departmentId: true, number: true, sheetData: true, styles: true },
        }),
    !opts.drafts || ids.length === 0
      ? Promise.resolve([])
      : prisma.budget.findMany({
          where: { projectId, departmentId: { in: ids } },
          select: {
            departmentId: true,
            styles: true,
            mainSheet: { select: { data: { select: { data: true } } } },
          },
        }),
    !opts.drafts || ids.length === 0
      ? Promise.resolve([])
      : prisma.budgetItem.groupBy({
          by: ["departmentId"],
          where: { projectId, departmentId: { in: ids }, archivedAt: null },
          _sum: { total: true },
        }),
  ]);

  const versionBy = new Map(versions.map((v) => [v.departmentId, v]));
  const budgetBy = new Map(budgets.map((b) => [b.departmentId, b]));
  const draftTotalBy = new Map(
    draftTotals.map((t) => [t.departmentId, Number(t._sum.total ?? 0)]),
  );
  const planBy = new Map(planFact.departments.map((d) => [d.id, d]));

  const styles: Record<string, unknown> = { ...SUMMARY_STYLES };
  const taken = new Set<string>(["свод"]);
  const sheets: { id: string; name: string; sortOrder: number; data: unknown }[] = [];
  const rows: SummaryRow[] = [];

  departments.forEach((d, index) => {
    const pf = planBy.get(d.id);
    rows.push({
      departmentName: d.name,
      versionNumber: pf?.versionNumber ?? null,
      draftTotal: opts.drafts && budgetBy.has(d.id) ? (draftTotalBy.get(d.id) ?? 0) : null,
      numbers: pf?.totals ?? planFactNumbers(0, 0, 0),
    });

    let data: Record<string, unknown>;
    if (opts.drafts) {
      const budget = budgetBy.get(d.id);
      const raw = budget?.mainSheet?.data?.data;
      data =
        raw && typeof raw === "object"
          ? prefixStyles(
              freezeSheetFormulas(raw as Record<string, unknown>),
              budget!.styles,
              `d${index}_`,
              styles,
            )
          : placeholderSheet("Смета цеха ещё не создана");
    } else {
      const version = versionBy.get(d.id);
      data =
        version && version.sheetData && typeof version.sheetData === "object"
          ? prefixStyles(
              JSON.parse(JSON.stringify(version.sheetData)) as Record<string, unknown>,
              version.styles,
              `d${index}_`,
              styles,
            )
          : placeholderSheet("Нет утверждённой версии — план цеха пуст");
    }
    sheets.push({
      id: `dept-${index + 1}`,
      name: sheetName(d.name, taken),
      sortOrder: index + 1,
      data,
    });
  });

  sheets.unshift({
    id: SUMMARY_SHEET_KEY,
    name: "Свод",
    sortOrder: 0,
    data: summarySheet(rows, planFact.unassigned, planFact.project, opts.drafts),
  });

  const workbook = assembleWorkbookFromSheets({
    budgetId: `summary-${projectId}`,
    name: "Сводная книга",
    styles,
    sheets,
  });
  return {
    workbook,
    sheetsMeta: sheets.map((s) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sortOrder,
      pinned: false,
    })),
    rows,
    unassigned: planFact.unassigned,
    project: planFact.project,
    drafts: opts.drafts,
  };
}
