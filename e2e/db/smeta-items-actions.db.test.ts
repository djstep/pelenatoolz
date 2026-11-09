import "../helpers/use-e2e-database";
import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { E2E_PROJECT_NAME, E2E_ROLES } from "../fixtures/data";

/**
 * Смета по статьям, шаг 4: настоящие серверные действия на базе e2e (`.env.e2e`), подменён
 * только вход пользователя. Не входит ни в `npm test`, ни в `npm run e2e`; запуск (база e2e,
 * одновременно с e2e не запускать):
 *
 *   node --import ./scripts/tz-utc.mjs --import tsx --experimental-test-module-mocks --test e2e/db/smeta-items-actions.db.test.ts
 *
 * Всё, что тест создаёт, помечено RUN и удаляется в конце.
 */

const db = new PrismaClient();
const RUN = Date.now().toString(36).toUpperCase();
const PREFIX = `Q${RUN.replace(/[^A-Z]/g, "").padEnd(4, "X").slice(0, 4)}`;

/** Кто вызывает действия: глава цеха теста или продюсер (не глава). */
let actor: { headDepartmentIds: string[]; producer: boolean } = { headDepartmentIds: [], producer: false };
let userId = "";

mock.module("server-only", { namedExports: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/features/projects/lib/project-context", {
  namedExports: {
    requireProjectContext: async () => ({
      user: { id: userId },
      role: actor.producer ? { isSystem: true, name: "Продюсер" } : { isSystem: false, name: "Глава" },
      can: () => false,
      headDepartmentIds: actor.headDepartmentIds,
    }),
  },
});

type Actions = typeof import("@/features/smeta/items-actions");
type Queries = typeof import("@/features/smeta/items-queries");
let A: Actions;
let Q: Queries;

let projectId = "";
let foreignProjectId = "";
let departmentId = "";
let otherDepartmentId = "";
let budgetId = "";
let templateTransport = "";
let templateCamera = "";
let templateArchived = "";
let foreignTemplate = "";
let smeny = "";
/** Исходное значение СМЕНЫ — вернуть после теста. */
let smenyBefore: string | null = null;
let nedeli = "";
let ip = "";
let selfEmployed = "";
let transportType = "";

function ok<T extends { error?: string; id?: string }>(r: T): string {
  assert.equal(r.error, undefined, r.error);
  assert.ok(r.id);
  return r.id!;
}

async function tree() {
  const t = await Q.getDepartmentItemsTree(projectId, departmentId);
  assert.ok(t);
  return t;
}

before(async () => {
  A = await import("@/features/smeta/items-actions");
  Q = await import("@/features/smeta/items-queries");
  const project = await db.project.findFirstOrThrow({
    where: { name: E2E_PROJECT_NAME, owner: { email: E2E_ROLES.producer.email } },
    select: { id: true, ownerUserId: true },
  });
  projectId = project.id;
  userId = project.ownerUserId;
  const foreign = await db.project.findFirst({ where: { id: { not: projectId } }, select: { id: true } });
  foreignProjectId = foreign?.id ?? "";

  const dep = await db.department.create({ data: { projectId, name: `Цех ${RUN}`, codePrefix: PREFIX } });
  departmentId = dep.id;
  const other = await db.department.create({
    data: { projectId, name: `Другой цех ${RUN}`, codePrefix: `${PREFIX.slice(0, 3)}Z` },
  });
  otherDepartmentId = other.id;
  budgetId = (await db.budget.create({ data: { projectId, departmentId } })).id;
  await db.budget.create({ data: { projectId, departmentId: otherDepartmentId } });

  const settings = await db.projectBudgetSettings.upsert({
    where: { projectId },
    create: { projectId },
    update: {},
  });
  let n = settings.lastTemplateArticleNumber + 100;
  const mk = (name: string, archived = false) =>
    db.budgetTemplateArticle.create({
      data: { projectId, number: ++n, name: `${name} ${RUN}`, archivedAt: archived ? new Date() : null },
    });
  templateTransport = (await mk("Транспорт")).id;
  templateCamera = (await mk("Камера")).id;
  templateArchived = (await mk("Архивная", true)).id;
  await db.projectBudgetSettings.update({ where: { projectId }, data: { lastTemplateArticleNumber: n } });
  if (foreignProjectId) {
    foreignTemplate = (
      await db.budgetTemplateArticle.create({ data: { projectId: foreignProjectId, number: 9000 + (Date.now() % 999), name: `Чужая ${RUN}` } })
    ).id;
  }

  const vars = await db.projectFinanceVariable.findMany({ where: { projectId, key: { in: ["SMENY", "NEDELI"] } } });
  smeny = vars.find((v) => v.key === "SMENY")!.id;
  smenyBefore = vars.find((v) => v.key === "SMENY")!.value?.toString() ?? null;
  nedeli = vars.find((v) => v.key === "NEDELI")!.id;
  await db.projectFinanceVariable.update({ where: { id: smeny }, data: { value: 10 } });
  await db.projectFinanceVariable.update({ where: { id: nedeli }, data: { value: null } });
  const forms = await db.projectPaymentForm.findMany({ where: { projectId, key: { in: ["IP", "SELF_EMPLOYED"] } } });
  ip = forms.find((f) => f.key === "IP")!.id;
  selfEmployed = forms.find((f) => f.key === "SELF_EMPLOYED")!.id;
  await db.projectPaymentForm.updateMany({ where: { id: { in: [ip, selfEmployed] } }, data: { defaultTaxPercent: 6 } });
  transportType = (await db.projectExpenseType.findFirstOrThrow({ where: { projectId, key: "TRANSPORT" } })).id;

  actor = { headDepartmentIds: [departmentId], producer: false };
});

after(async () => {
  await db.budgetItem.deleteMany({ where: { departmentId: { in: [departmentId, otherDepartmentId] } } });
  await db.budgetSubarticle.deleteMany({ where: { article: { budget: { departmentId: { in: [departmentId, otherDepartmentId] } } } } });
  await db.budgetArticle.deleteMany({ where: { budget: { departmentId: { in: [departmentId, otherDepartmentId] } } } });
  await db.budget.deleteMany({ where: { departmentId: { in: [departmentId, otherDepartmentId] } } });
  await db.department.deleteMany({ where: { id: { in: [departmentId, otherDepartmentId] } } });
  await db.budgetTemplateArticle.deleteMany({ where: { name: { contains: RUN } } });
  await db.auditLog.deleteMany({ where: { projectId, summary: { contains: RUN } } });
  await db.projectFinanceVariable.update({ where: { id: smeny }, data: { value: smenyBefore } });
  await db.$disconnect();
});

describe("смета по статьям: действия главы цеха", () => {
  let article = "";
  let sub = "";
  let line = "";

  test("взять статью, добавить подстатью и строку: номер, код, налог из формы, расчёт", async () => {
    article = ok(await A.takeTemplateArticleAction(projectId, departmentId, templateTransport));
    sub = ok(await A.addSubarticleAction(projectId, departmentId, article, "  Спецтранспорт  "));
    line = ok(
      await A.addLineAction(projectId, departmentId, sub, {
        name: "Камерваген",
        unit: "смена",
        quantity: "1",
        rate: "15000",
        multipliers: [{ variableId: smeny }],
        expenseTypeId: transportType,
        paymentFormId: ip,
      }),
    );

    const row = await db.budgetItem.findUniqueOrThrow({
      where: { id: line },
      include: { subarticle: { include: { article: { include: { templateArticle: true } } } } },
    });
    const two = (n: number) => String(n).padStart(2, "0");
    assert.equal(row.code, `${PREFIX}-${two(row.subarticle!.article.templateArticle.number)}.${two(row.subarticle!.number)}.01`);
    assert.equal(row.number, 1);
    assert.equal(row.departmentId, departmentId);
    assert.equal(row.taxPercent?.toString(), "6");
    // 1 × 15 000 × СМЕНЫ(10) = 150 000; налог 6 % = 9 000.
    assert.equal(row.amount.toFixed(2), "150000.00");
    assert.equal(row.total.toFixed(2), "159000.00");

    const t = await tree();
    assert.equal(t.totals.total, "159000.00");
    assert.equal(t.articles[0]!.subarticles[0]!.name, "Спецтранспорт");
    // В дереве для экрана нет внутренних кодов.
    assert.doesNotMatch(JSON.stringify(t), new RegExp(`${PREFIX}-`));
  });

  test("пустая переменная: строка без суммы, с пометкой, в итог не входит", async () => {
    ok(
      await A.addLineAction(projectId, departmentId, sub, {
        name: "Гримваген",
        quantity: "1",
        rate: "10000",
        multipliers: [{ variableId: nedeli }],
      }),
    );
    const t = await tree();
    const grim = t.articles[0]!.subarticles[0]!.lines.find((l) => l.name === "Гримваген")!;
    assert.equal(grim.total, null);
    assert.deepEqual(grim.problems, [{ kind: "variable_missing", variableId: nedeli }]);
    assert.equal(t.totals.total, "159000.00");
    assert.equal(t.totals.incomplete, 1);
  });

  test("правка строки: смена формы без налога — процент новой формы; свой процент; без изменений — ревизия та же", async () => {
    const revision = async () => (await db.budget.findUniqueOrThrow({ where: { id: budgetId } })).revision;
    const base = {
      name: "Камерваген",
      unit: "смена",
      quantity: "1",
      rate: "15000",
      multipliers: [{ variableId: smeny }],
      expenseTypeId: transportType,
    };
    const r0 = await revision();
    ok(await A.updateLineAction(projectId, departmentId, line, { ...base, paymentFormId: ip }));
    assert.equal(await revision(), r0, "ничего не изменилось — ревизия та же");

    await db.projectPaymentForm.update({ where: { id: selfEmployed }, data: { defaultTaxPercent: 4 } });
    ok(await A.updateLineAction(projectId, departmentId, line, { ...base, paymentFormId: selfEmployed }));
    let row = await db.budgetItem.findUniqueOrThrow({ where: { id: line } });
    assert.equal(row.taxPercent?.toString(), "4");
    assert.equal(await revision(), r0 + 1);

    ok(await A.updateLineAction(projectId, departmentId, line, { ...base, paymentFormId: selfEmployed, taxPercent: "6,5" }));
    row = await db.budgetItem.findUniqueOrThrow({ where: { id: line } });
    assert.equal(row.taxPercent?.toString(), "6.5");
    assert.equal(row.total.toFixed(2), "159750.00");
    await db.projectPaymentForm.update({ where: { id: selfEmployed }, data: { defaultTaxPercent: 6 } });
  });

  test("перемещение и архив: порядок, итоги без архивного, номера не переиспользуются", async () => {
    const third = ok(await A.addLineAction(projectId, departmentId, sub, { name: "Тонваген", quantity: 1, rate: 5000 }));
    ok(await A.moveItemsNodeAction(projectId, departmentId, "line", third, "up"));
    let names = (await tree()).articles[0]!.subarticles[0]!.lines.map((l) => l.name);
    assert.deepEqual(names, ["Камерваген", "Тонваген", "Гримваген"]);

    ok(await A.setItemsNodeArchivedAction(projectId, departmentId, "line", third, true));
    const t = await tree();
    assert.equal(t.totals.total, "159750.00");
    names = t.articles[0]!.subarticles[0]!.lines.filter((l) => !l.archived).map((l) => l.name);
    assert.deepEqual(names, ["Камерваген", "Гримваген"]);

    const fourth = ok(await A.addLineAction(projectId, departmentId, sub, { name: "Ещё строка" }));
    const numbers = await db.budgetItem.findMany({ where: { subarticleId: sub }, select: { id: true, number: true } });
    assert.equal(numbers.find((x) => x.id === fourth)!.number, 4);

    ok(await A.setItemsNodeArchivedAction(projectId, departmentId, "line", third, false));
    ok(await A.setItemsNodeArchivedAction(projectId, departmentId, "subarticle", sub, true));
    assert.equal((await tree()).totals.total, "0.00");
    // Строки архивной подстатьи не предлагаются в начислениях и платежах и не принимаются сервером.
    const { listVisibleBudgetItems, checkBudgetItemsUsable } = await import("@/features/smeta/budget-item-access");
    const viewer = { role: { isSystem: true, name: "Продюсер" }, can: () => false, headDepartmentIds: [] };
    const visible = await listVisibleBudgetItems(projectId, viewer);
    assert.equal(visible.some((o) => o.id === line), false);
    assert.match((await checkBudgetItemsUsable(projectId, viewer, [line])) ?? "", /в архиве/);
    assert.match(
      (await A.updateLineAction(projectId, departmentId, line, { name: "В архивной подстатье" })).error ?? "",
      /в архиве/,
    );
    // Повторно в архив — «без изменений», не ошибка.
    const again = await A.setItemsNodeArchivedAction(projectId, departmentId, "subarticle", sub, true);
    assert.equal(again.error, undefined);
    ok(await A.setItemsNodeArchivedAction(projectId, departmentId, "subarticle", sub, false));
    // Слишком большая сумма — понятный отказ, а не сбой базы.
    const huge = await A.addLineAction(projectId, departmentId, sub, {
      name: "Огромная",
      quantity: "999999999999",
      rate: "999999999999",
    });
    assert.match(huge.error ?? "", /слишком большая/);
  });

  test("утверждённая смета после правки — «черновик», с записью в журнал", async () => {
    await db.budget.update({ where: { id: budgetId }, data: { status: "APPROVED" } });
    ok(await A.renameSubarticleAction(projectId, departmentId, sub, `Спецтранспорт ${RUN}`));
    const budget = await db.budget.findUniqueOrThrow({ where: { id: budgetId } });
    assert.equal(budget.status, "DRAFT");
    const log = await db.auditLog.findFirst({
      where: { projectId, entityId: budgetId, summary: { contains: "изменена после утверждения" } },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(log);
    const renameLog = await db.auditLog.findFirst({ where: { projectId, summary: { contains: `«Спецтранспорт ${RUN}»` } } });
    assert.ok(renameLog);
    assert.doesNotMatch(renameLog!.summary ?? "", new RegExp(`${PREFIX}-`));
  });

  test("отказы: архивная статья шаблона, повторно та же статья, чужой проект, чужой цех", async () => {
    assert.match((await A.takeTemplateArticleAction(projectId, departmentId, templateArchived)).error ?? "", /в архиве/);
    assert.match((await A.takeTemplateArticleAction(projectId, departmentId, templateTransport)).error ?? "", /уже есть/);
    if (foreignTemplate) {
      assert.equal((await A.takeTemplateArticleAction(projectId, departmentId, foreignTemplate)).error, "Не найдено");
    }
    // Подстатья этого цеха — через чужой цех (глава обоих) не найти.
    actor = { headDepartmentIds: [departmentId, otherDepartmentId], producer: false };
    assert.equal((await A.addLineAction(projectId, otherDepartmentId, sub, { name: "Чужая" })).error, "Не найдено");
    assert.equal(
      (await A.updateLineAction(projectId, otherDepartmentId, line, { name: "Подмена" })).error,
      "Не найдено",
    );
    actor = { headDepartmentIds: [departmentId], producer: false };
    // Переменная чужого проекта.
    if (foreignProjectId) {
      const foreignVar = await db.projectFinanceVariable.findFirst({ where: { projectId: foreignProjectId } });
      if (foreignVar) {
        const r = await A.updateLineAction(projectId, departmentId, line, {
          name: "Камерваген",
          multipliers: [{ variableId: foreignVar.id }],
        });
        assert.match(r.error ?? "", /не найдены/);
      }
    }
    // Подделанные значения.
    assert.equal((await A.setItemsNodeArchivedAction(projectId, departmentId, "line", line, "false" as unknown as boolean)).error, "Не найдено");
    assert.match((await A.addLineAction(projectId, departmentId, sub, { name: "x", taxPercent: "150" })).error ?? "", /Налог/);
  });

  test("права: продюсер (не глава) и глава другого цеха смету не правят", async () => {
    const before = await db.budgetItem.count({ where: { departmentId } });
    actor = { headDepartmentIds: [], producer: true };
    assert.equal((await A.addLineAction(projectId, departmentId, sub, { name: "Продюсер" })).error, "Смету цеха правит глава цеха");
    assert.equal((await A.takeTemplateArticleAction(projectId, departmentId, templateCamera)).error, "Смету цеха правит глава цеха");
    actor = { headDepartmentIds: [otherDepartmentId], producer: false };
    assert.equal((await A.updateLineAction(projectId, departmentId, line, { name: "Подмена" })).error, "Смету цеха правит глава цеха");
    assert.equal(await db.budgetItem.count({ where: { departmentId } }), before);
    actor = { headDepartmentIds: [departmentId], producer: false };
  });
});
