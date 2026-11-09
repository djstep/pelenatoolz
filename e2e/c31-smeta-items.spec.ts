import { expect, test } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Волна «Смета по статьям». Шаг 2: справочники сметы есть в проекте после миграции,
 * новые переменные пустые, открытие настроек финансов в базу ничего не пишет.
 */

const ctx = e2eContext();
const db = e2eDb();
test.use({ storageState: storageStatePath("producer") });

test.afterAll(async () => {
  await db.$disconnect();
});

/** Снимок справочников сметы проекта: число строк и последнее изменение. */
async function directoriesSnapshot(projectId: string) {
  const where = { projectId };
  const [settings, expenseTypes, paymentForms, mappings, variables] = await Promise.all([
    db.projectBudgetSettings.findUnique({ where, select: { updatedAt: true } }),
    db.projectExpenseType.aggregate({ where, _count: true, _max: { updatedAt: true } }),
    db.projectPaymentForm.aggregate({ where, _count: true, _max: { updatedAt: true } }),
    db.projectCounterpartyPaymentForm.aggregate({ where, _count: true, _max: { updatedAt: true } }),
    db.projectFinanceVariable.aggregate({ where, _count: true, _max: { updatedAt: true } }),
  ]);
  return { settings, expenseTypes, paymentForms, mappings, variables };
}

test("справочники сметы в проекте: типы расходов, формы оплаты, сопоставление, переменные", async () => {
  const project = await db.project.findUniqueOrThrow({
    where: { id: ctx.projectId },
    select: {
      budgetSettings: { select: { reservePercent: true, agencyPercent: true } },
      expenseTypes: { select: { name: true }, orderBy: { sortOrder: "asc" } },
      paymentForms: { select: { key: true, defaultTaxPercent: true }, orderBy: { sortOrder: "asc" } },
      counterpartyPaymentForms: { select: { counterpartyType: true, paymentForm: { select: { key: true } } } },
      financeVariables: { where: { isSystem: true }, select: { key: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  expect(project.budgetSettings).not.toBeNull();
  expect(project.expenseTypes.map((t) => t.name)).toEqual([
    "Гонорар / ФОТ",
    "Аренда техники",
    "Покупка / расходники",
    "Транспорт",
    "Услуги подрядчика",
    "Площадки",
    "Питание",
    "Проживание",
    "Суточные",
    "Прочее",
  ]);
  expect(project.paymentForms.map((f) => [f.key, Number(f.defaultTaxPercent)])).toEqual([
    ["SELF_EMPLOYED", 6],
    ["IP", 6],
    ["GPH", 13],
    ["CASH", 0],
    ["LEGAL_ENTITY", 0],
  ]);
  expect(
    Object.fromEntries(project.counterpartyPaymentForms.map((m) => [m.counterpartyType, m.paymentForm.key])),
  ).toEqual({ LEGAL_ENTITY: "LEGAL_ENTITY", IP: "IP", SELF_EMPLOYED: "SELF_EMPLOYED", INDIVIDUAL: "GPH" });
  expect(project.financeVariables.map((v) => v.key)).toEqual(["SMENY", "SERII", "DNI_PODGOTOVKI", "NEDELI"]);
});

test("настройки финансов: новые переменные видны и пустые; открытие страницы ничего не пишет", async ({ page }) => {
  await db.projectFinanceVariable.updateMany({
    where: { projectId: ctx.projectId, key: { in: ["DNI_PODGOTOVKI", "NEDELI"] } },
    data: { value: null },
  });
  const before = await directoriesSnapshot(ctx.projectId);

  await page.goto(projectPath(ctx, "/finance/settings"));
  for (const label of ["ДНИ ПОДГОТОВКИ", "НЕДЕЛИ"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.locator("#val-DNI_PODGOTOVKI")).toHaveValue("");
  await expect(page.locator("#val-NEDELI")).toHaveValue("");
  await page.waitForLoadState("networkidle");

  expect(await directoriesSnapshot(ctx.projectId)).toEqual(before);
});
