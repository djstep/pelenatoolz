import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nodeModule from "node:module";
import { before, describe, test } from "node:test";
import type { ExportDb } from "@/features/smeta/export-queries";
import { MAIN_HEADERS } from "@/features/smeta/lib/main-sheet";
import { canReadDepartmentSmeta, type SmetaAccessContext } from "@/features/smeta/lib/smeta-access";

// export-queries.ts и smeta-access.ts — серверные модули ("server-only"): берём их с условием react-server.
type ResolveContext = { conditions: string[] };
type RegisterHooks = (hooks: {
  resolve: (
    specifier: string,
    context: ResolveContext,
    nextResolve: (specifier: string, context: ResolveContext) => unknown,
  ) => unknown;
}) => void;
(nodeModule as unknown as { registerHooks: RegisterHooks }).registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return nextResolve(specifier, {
        ...context,
        conditions: [...context.conditions, "react-server"],
      });
    }
    return nextResolve(specifier, context);
  },
});

type Queries = typeof import("@/features/smeta/export-queries");
let loadDepartmentBudgetExport: Queries["loadDepartmentBudgetExport"];
let canRead: typeof canReadDepartmentSmeta;
before(async () => {
  ({ loadDepartmentBudgetExport } = await import("@/features/smeta/export-queries"));
  ({ canReadDepartmentSmeta: canRead } = await import("@/features/smeta/lib/smeta-access"));
});

/** Основной лист с шапкой сметы: статья в строке 1 (sortOrder 1), Сумма / Налог / Итого — формулы. */
function mainSheetData() {
  return {
    id: "main",
    name: "Смета",
    cellData: {
      0: Object.fromEntries(MAIN_HEADERS.map((h, i) => [i, { v: h, t: 1 }])),
      1: {
        0: { v: "ЗВ-01.01", t: 1 },
        6: { v: 1, t: 2, f: "=D2*E2*F2" },
        8: { v: 1, t: 2, f: "=G2*H2/100" },
        9: { v: 1, t: 2, f: "=G2+I2" },
      },
      2: { 9: { v: 1, t: 2, f: "=СУММ(J2:J2)" } },
    },
  };
}

type Call = { model: string; args: Record<string, unknown> };

function fakeDb(opts: {
  budget: { status: "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED" } | null;
  versions?: number[];
}) {
  const calls: Call[] = [];
  const versions = opts.versions ?? [];
  const db = {
    budget: {
      findFirst: async (args: Record<string, unknown>) => {
        calls.push({ model: "budget", args });
        if (!opts.budget) return null;
        return {
          status: opts.budget.status,
          styles: { s1: { bl: 1 } },
          mainSheet: { name: "Смета", data: { data: mainSheetData() } },
          // Черновые листы, если бы их кто-то запросил, — выгрузка их не читает.
          sheets: [{ name: "Черновик главы", data: { data: { cellData: { 0: { 0: { v: "секрет" } } } } } }],
        };
      },
    },
    budgetVersion: {
      findFirst: async (args: { where: { number?: number }; select: Record<string, unknown> }) => {
        calls.push({ model: "budgetVersion", args });
        if (args.where.number === undefined) {
          const latest = Math.max(0, ...versions);
          return latest ? { number: latest } : null;
        }
        if (!versions.includes(args.where.number)) return null;
        return {
          sheetName: `Смета v${args.where.number}`,
          sheetData: { cellData: { 0: { 0: { v: `версия ${args.where.number}`, t: 1 } } } },
          styles: {},
          approvedAt: new Date("2026-11-01T10:00:00.000Z"),
          approvedByName: "Продюсер",
          approvedByHead: false,
        };
      },
    },
    budgetItem: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ model: "budgetItem", args });
        return [{ sortOrder: 1, amount: 1000, tax: 130, total: 1130 }];
      },
    },
  };
  return { db: db as unknown as ExportDb, calls };
}

function hasFormula(data: Record<string, unknown>) {
  const cells = (data.cellData ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  return Object.values(cells).some((line) => Object.values(line).some((c) => c && "f" in c));
}

describe("что выгружается из сметы цеха", () => {
  test("черновик: текущий основной лист, формулы → значения, Сумма / Налог / Итого — расчёт сервера", async () => {
    const { db, calls } = fakeDb({ budget: { status: "SUBMITTED" }, versions: [1, 2] });
    const res = await loadDepartmentBudgetExport(db, "p1", "d1", undefined);
    assert.ok(!("error" in res));
    assert.deepEqual(res.source, { kind: "current", status: "SUBMITTED" });
    assert.equal(res.sheet.name, "Смета");
    assert.equal(hasFormula(res.sheet.data), false);
    const cells = res.sheet.data.cellData as Record<number, Record<number, { v: unknown }>>;
    assert.equal(cells[1]![6]!.v, 1000);
    assert.equal(cells[1]![8]!.v, 130);
    assert.equal(cells[1]![9]!.v, 1130);
    assert.equal(cells[2]![9]!.v, 1130, "подытог пересчитан");
    assert.equal(res.approved, null);
    // Из книги читается только основной лист, черновые листы не запрашиваются.
    const budgetSelect = calls.find((c) => c.model === "budget")!.args.select as Record<string, unknown>;
    assert.deepEqual(Object.keys(budgetSelect).sort(), ["mainSheet", "status", "styles"]);
    assert.ok(!JSON.stringify(res).includes("секрет"));
    // Только действующие статьи этого цеха и проекта.
    const itemsWhere = calls.find((c) => c.model === "budgetItem")!.args.where;
    assert.deepEqual(itemsWhere, { projectId: "p1", departmentId: "d1", archivedAt: null });
  });

  test("утверждена: по умолчанию — последняя утверждённая версия", async () => {
    const { db, calls } = fakeDb({ budget: { status: "APPROVED" }, versions: [1, 2] });
    const res = await loadDepartmentBudgetExport(db, "p1", "d1", undefined);
    assert.ok(!("error" in res));
    assert.deepEqual(res.source, { kind: "version", number: 2 });
    assert.equal(res.sheet.name, "Смета v2");
    assert.equal(res.approved?.byName, "Продюсер");
    assert.equal(calls.some((c) => c.model === "budgetItem"), false, "черновик не читается");
    for (const c of calls.filter((x) => x.model === "budgetVersion")) {
      const where = c.args.where as Record<string, unknown>;
      assert.equal(where.projectId, "p1");
      assert.equal(where.departmentId, "d1");
    }
  });

  test("выбранная версия — она; чужой номер — «Версия не найдена»", async () => {
    const { db } = fakeDb({ budget: { status: "DRAFT" }, versions: [1, 2] });
    const one = await loadDepartmentBudgetExport(db, "p1", "d1", 1);
    assert.ok(!("error" in one));
    assert.deepEqual(one.source, { kind: "version", number: 1 });
    assert.deepEqual(await loadDepartmentBudgetExport(db, "p1", "d1", 7), { error: "Версия не найдена" });
  });

  test("сметы нет — понятный отказ", async () => {
    const { db } = fakeDb({ budget: null });
    assert.deepEqual(await loadDepartmentBudgetExport(db, "p1", "d1", undefined), {
      error: "Смета ещё не создана",
    });
  });
});

describe("права на Excel сметы цеха", () => {
  const ctx = (over: Partial<SmetaAccessContext>): SmetaAccessContext => ({
    role: { isSystem: false, name: "Глава" },
    can: () => false,
    headDepartmentIds: [],
    ...over,
  });

  test("глава этого цеха, продюсер, «просмотр всех» — да; глава чужого цеха — нет", () => {
    assert.equal(canRead(ctx({ headDepartmentIds: ["d-sound"] }), "d-sound"), true);
    assert.equal(canRead(ctx({ headDepartmentIds: ["d-sound"] }), "d-art"), false);
    assert.equal(canRead(ctx({ role: { isSystem: true, name: "Продюсер" } }), "d-art"), true);
    assert.equal(canRead(ctx({ can: (p) => p === "smeta:read_all" }), "d-art"), true);
    assert.equal(canRead(ctx({}), "d-art"), false);
  });

  test("действие: отказ по правам — до поиска цеха, чтения сметы и сборки файла", () => {
    const src = readFileSync(new URL("./export-actions.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function exportDepartmentBudgetAction"));
    const at = (needle: string) => {
      const i = body.indexOf(needle);
      assert.ok(i > 0, needle);
      return i;
    };
    assert.ok(at("requireProjectContext(projectId)") < at("canReadDepartmentSmeta(ctx, departmentId)"));
    assert.ok(at("canReadDepartmentSmeta(ctx, departmentId)") < at('assertInProject("Department"'));
    assert.ok(at('assertInProject("Department"') < at("buildDepartmentBudgetFile("));
    // Тот же файл, что уходит на диск: сначала смета и версия этого цеха, потом книга.
    const file = readFileSync(new URL("./export-file.ts", import.meta.url), "utf8");
    assert.ok(file.indexOf("loadDepartmentBudgetExport(") < file.indexOf("buildDepartmentBudgetWorkbook("));
    // Журнал — тип «Выгрузка смет», без сумм.
    const audit = body.slice(at("recordAudit("));
    assert.match(audit, /AuditEntityType\.smetaExport/);
    assert.doesNotMatch(audit.slice(0, audit.indexOf("});")), /total|amount|sum\b/i);
  });

  test("на диск: вход → разбор ввода → цех проекта → право (продюсер / глава этого цеха) → файл → диск", () => {
    const src = readFileSync(new URL("./drive-actions.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function exportBudgetToDriveAction"));
    const order = [
      "requireProjectContext(projectId)",
      "parseBudgetDriveRequest(input)",
      'if ("drafts" in parsed) return { error: NO_RIGHTS }',
      "departmentOfProject(projectId, parsed.target.departmentId)",
      "canExportBudgetToDrive(budgetActor(ctx)",
      "buildDepartmentBudgetFile(",
      "putBudgetOnProjectDrive(",
    ].map((s) => body.indexOf(s));
    for (const [i, at] of order.entries()) assert.ok(at > 0, `нет шага ${i}`);
    for (let i = 1; i < order.length; i++) assert.ok(order[i - 1]! < order[i]!, `порядок ${i}`);
    // projectId и всё остальное — не из ввода: в выгрузку идут только цех и номер версии.
    assert.doesNotMatch(body, /parsed\.(projectId|email|folder)/);
    // Окно тоже не показывает ничего без права выгружать.
    const state = src.slice(src.indexOf("export async function getBudgetDriveStateAction"), src.indexOf("export type BudgetDriveExportResult"));
    assert.ok(state.indexOf("canExportBudgetToDrive(") < state.indexOf("Promise.all("));
  });

  test("сводная на диск: вход → разбор ввода (только «сводная») → только продюсер → книга → диск", () => {
    const src = readFileSync(new URL("./drive-actions.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function exportBudgetSummaryToDriveAction"));
    const order = [
      "requireProjectContext(projectId)",
      "parseBudgetDriveRequest(input)",
      'if (!("drafts" in parsed)) return { error: DRIVE_EXPORT_BAD_INPUT }',
      "canExportBudgetToDrive(budgetActor(ctx), SUMMARY)",
      "buildSummaryBudgetFile(",
      "putBudgetSummaryOnProjectDrive(",
    ].map((s) => body.indexOf(s));
    for (const [i, at] of order.entries()) assert.ok(at > 0, `нет шага ${i}`);
    for (let i = 1; i < order.length; i++) assert.ok(order[i - 1]! < order[i]!, `порядок ${i}`);
    // Из ввода — только режим.
    assert.doesNotMatch(body, /parsed\.(projectId|email|folder|target\.departmentId)/);
    // Окно тоже — только продюсеру, до чтения.
    const state = src.slice(
      src.indexOf("export async function getBudgetSummaryDriveStateAction"),
      src.indexOf("export type BudgetSummaryDriveExportResult"),
    );
    assert.ok(state.indexOf("canExportBudgetToDrive(budgetActor(ctx), SUMMARY)") > 0);
    assert.ok(state.indexOf("canExportBudgetToDrive(") < state.indexOf("Promise.all("));
    // Смету цеха действие сводной не выгружает, а действие сметы цеха — сводную.
    const dept = src.slice(src.indexOf("export async function exportBudgetToDriveAction"), src.indexOf("// ---------- сводная"));
    assert.ok(dept.includes('if ("drafts" in parsed) return { error: NO_RIGHTS }'));
  });

  test("«Экспорт Excel» сводной и диск — один файл (общий сборщик)", () => {
    const actions = readFileSync(new URL("./export-actions.ts", import.meta.url), "utf8");
    const body = actions.slice(
      actions.indexOf("export async function exportSummaryBookAction"),
      actions.indexOf("export async function exportDepartmentBudgetAction"),
    );
    assert.ok(body.indexOf("canReadAllSmeta(ctx)") < body.indexOf("buildSummaryBudgetFile("));
    assert.match(body, /summaryExportFileName\(/);
    const file = readFileSync(new URL("./export-file.ts", import.meta.url), "utf8");
    const summary = file.slice(file.indexOf("export async function buildSummaryBudgetFile"));
    assert.ok(summary.indexOf("getSummaryBook(") < summary.indexOf("addExportInfoSheet("));
  });
});
