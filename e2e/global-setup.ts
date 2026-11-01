import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { E2E_ROLES, passwordEnvName, type E2ERoleKey } from "./fixtures/data";
import { e2eDb, loadE2EContext } from "./helpers/db";
import { storageStatePath } from "./helpers/session";

const AUTH_DIR = path.join(__dirname, ".auth");

/**
 * Вход через форму под каждой ролью из `.env.e2e`, сессии — в `e2e/.auth/` (в .gitignore).
 * Трасса и видео здесь не пишутся; ошибка входа — без подробностей (в них мог бы быть пароль).
 */
export default async function globalSetup(config: FullConfig) {
  loadEnv({ path: path.join(process.cwd(), ".env.e2e"), quiet: true });
  mkdirSync(AUTH_DIR, { recursive: true });
  const baseURL = config.projects[0].use.baseURL ?? "http://localhost:3000";

  const db = e2eDb();
  try {
    const ctx = await loadE2EContext(db);
    writeFileSync(path.join(AUTH_DIR, "context.json"), JSON.stringify(ctx, null, 2));
  } finally {
    await db.$disconnect();
  }

  const browser = await chromium.launch();
  try {
    for (const role of Object.keys(E2E_ROLES) as E2ERoleKey[]) {
      const password = process.env[passwordEnvName(role)];
      if (!password) throw new Error(`Нет пароля роли ${role} в .env.e2e — запустите npx tsx scripts/e2e-seed.ts`);
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      try {
        await page.goto("/ru/login", { timeout: 120_000 });
        await page.locator("#email").fill(E2E_ROLES[role].email);
        await page.locator("#password").fill(password);
        await page.locator('form button[type="submit"]').click();
        await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 90_000 });
      } catch {
        throw new Error(`Вход под ${E2E_ROLES[role].email} не удался`);
      }
      await context.storageState({ path: storageStatePath(role) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
