import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import { type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { dayId, e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Волна 7: все адреса страниц проекта открываются, и у каждой роли набор доступных страниц
 * и ссылок меню тот же, что до волны. Пишет `<папка>/pages-<роль>.json`, сравнивает потом
 * отдельный скрипт по снимку старого кода. Только по команде: `E2E_PAGES_OUT=<папка>`.
 */

const OUT = process.env.E2E_PAGES_OUT;
const ctx = e2eContext();

test.skip(!OUT, "только с E2E_PAGES_OUT");

type Ids = Record<string, string | number | undefined>;

async function seedIds(): Promise<Ids> {
  const db = e2eDb();
  const where = { projectId: ctx.projectId };
  const select = { id: true } as const;
  const [
    character, counterparty, contract, location, payment, audition, person, candidate,
    actor, category, version, scene, departmentVersion, department,
  ] = await Promise.all([
    db.character.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.counterparty.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.contract.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.location.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.cashPayment.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.audition.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.castingPerson.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.scoutCandidate.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.actor.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.resourceCategory.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.scriptVersion.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.scene.findFirst({ where, select, orderBy: { id: "asc" } }),
    db.budgetVersion.findFirst({ where, select: { departmentId: true, number: true }, orderBy: { id: "asc" } }),
    db.department.findFirst({ where, select, orderBy: { id: "asc" } }),
  ]);
  const item = category
    ? await db.resourceItem.findFirst({ where: { categoryId: category.id }, select, orderBy: { id: "asc" } })
    : null;
  await db.$disconnect();
  return {
    day: dayId(ctx, 1),
    character: character?.id,
    counterparty: counterparty?.id,
    contract: contract?.id,
    location: location?.id,
    payment: payment?.id,
    audition: audition?.id,
    person: person?.id,
    candidate: candidate?.id,
    actor: actor?.id,
    category: category?.id,
    item: item?.id,
    version: version?.id,
    scene: scene?.id,
    department: departmentVersion?.departmentId ?? department?.id,
    versionNumber: departmentVersion?.number,
  };
}

/** Список из разбора волны; `:имя` — данные сида, нет их — адрес помечается «нет данных». */
const ADDRESSES = [
  "",
  "/accruals", "/accruals/shift-entry",
  "/actors", "/actors/employment/:day",
  "/audit",
  "/call-sheets", "/call-sheets/:day",
  "/cast",
  "/characters", "/characters/:character", "/characters/employment/:day",
  "/counterparties", "/counterparties/:counterparty", "/counterparties/acts",
  "/counterparties/contracts", "/counterparties/contracts/:contract",
  "/crew",
  "/files",
  "/finance", "/finance/reports", "/finance/settings",
  "/import",
  "/libretto", "/libretto/:scene",
  "/locations", "/locations/:location",
  "/members",
  "/payments", "/payments/:payment",
  "/post",
  "/preproduction", "/preproduction/auditions", "/preproduction/auditions/:audition",
  "/preproduction/casting", "/preproduction/casting/:person",
  "/preproduction/scout", "/preproduction/scout/:candidate",
  "/reports", "/reports/:day",
  "/resource-usage", "/resource-usage/actors/:actor", "/resource-usage/resources/:item",
  "/resources", "/resources/:category", "/resources/:category/items/:item",
  "/roles",
  "/schedule", "/schedule/availability",
  "/screenplay", "/screenplay/:version", "/screenplay/:version/sync",
  "/screenplay/compare", "/screenplay/dictionary", "/screenplay/import",
  "/script",
  "/settings", "/settings/call-sheet-template", "/settings/departments", "/settings/resources",
  "/settings/resources/:category", "/settings/resources/:category/items/:item",
  "/smeta", "/smeta/:department", "/smeta/:department/review",
  "/smeta/:department/versions", "/smeta/:department/versions/:versionNumber",
  "/smeta/plan-fact", "/smeta/summary",
];

function fill(address: string, ids: Ids) {
  const missing: string[] = [];
  const filled = address.replace(/:(\w+)/g, (_, name: string) => {
    const value = ids[name];
    if (value === undefined) missing.push(name);
    return String(value);
  });
  return { filled, missing };
}

/** Адрес внутри проекта без его начала и параметров; чужой адрес — null. */
const inProject = (href: string | null, base: string) =>
  href?.startsWith(base) ? href.slice(base.length).split("?")[0] || "/" : null;

async function linksIn(page: Page, selector: string, base: string) {
  const hrefs = await page
    .locator(`${selector} a[href]`)
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  return hrefs.map((href) => inProject(href, base)).filter((href): href is string => href !== null);
}

for (const role of ["producer", "nofin", "crewonly"] as const satisfies readonly E2ERoleKey[]) {
  test.describe(role, () => {
    test.use({ storageState: storageStatePath(role) });

    test("страницы и ссылки меню", async ({ page }) => {
      test.setTimeout(45 * 60_000);
      const ids = await seedIds();
      const base = projectPath(ctx);
      const pages: Record<string, unknown> = {};
      const menu = new Set<string>();
      const errors: string[] = [];

      for (const address of ADDRESSES) {
        const { filled, missing } = fill(address, ids);
        if (missing.length > 0) {
          pages[address] = { skipped: `нет данных: ${missing.join(", ")}` };
          continue;
        }
        const response = await page.goto(`${base}${filled}`);
        const text = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
        pages[address] = {
          status: response?.status() ?? null,
          final: inProject(new URL(page.url()).pathname, base) ?? new URL(page.url()).pathname,
          denied: /Нет доступа/.test(text),
        };
        if ((response?.status() ?? 0) >= 500) errors.push(`${address}: ${response?.status()}`);
        for (const href of await linksIn(page, "nav", base)) menu.add(href);
      }

      mkdirSync(OUT!, { recursive: true });
      writeFileSync(
        path.join(OUT!, `pages-${role}.json`),
        JSON.stringify({ pages, menu: [...menu].sort() }, null, 2),
      );
      if (errors.length > 0) throw new Error(`Ошибка сервера:\n${errors.join("\n")}`);
    });
  });
}
