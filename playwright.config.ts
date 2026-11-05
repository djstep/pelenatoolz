import "./e2e/helpers/use-e2e-database";
import { defineConfig, devices } from "@playwright/test";

/**
 * Приёмочные тесты (`e2e/`): база только из `E2E_DATABASE_URL` и `E2E_DIRECT_URL` в `.env.e2e`.
 * Запуск — `npm run e2e` (сид проекта «E2E приёмка», затем тесты).
 * Сайт на эту же базу поднимает сам Playwright: уже занятый порт — ошибка, чужой сайт не подойдёт.
 * Адрес сайта — `E2E_BASE_URL` (по умолчанию http://localhost:3100), только на этой машине.
 * `E2E_CLOUD_STUB_URL` — заглушка дисков для сайта и тестов (`global-setup.ts`).
 */
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

// До чтения в спеках и в рабочих процессах Playwright: они загружают этот же файл.
process.env.E2E_BASE_URL ??= "http://localhost:3100";
const siteUrl = new URL(process.env.E2E_BASE_URL);
if (!LOCAL_HOSTS.includes(siteUrl.hostname)) {
  throw new Error(`E2E остановлен: сайт ${siteUrl.hostname} не на этой машине, его база не проверяется`);
}
const cloudStub = process.env.E2E_CLOUD_STUB_URL?.trim().replace(/\/+$/, "");

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./e2e/global-setup.ts",
  // Одна база и один dev-сервер: тесты по очереди, состояние вызывных предсказуемо.
  workers: 1,
  fullyParallel: false,
  // Первая компиляция страницы в `next dev` бывает долгой.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  webServer: {
    command: `npx next dev -p ${siteUrl.port || 80}`,
    url: `${siteUrl.origin}/ru/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL as string,
      DIRECT_URL: process.env.DIRECT_URL as string,
      APP_URL: siteUrl.origin,
      // next-auth берёт AUTH_URL раньше NEXTAUTH_URL из `.env`: вход не уйдёт на другой порт.
      AUTH_URL: siteUrl.origin,
      ...(cloudStub
        ? {
            CLOUD_STUB_GOOGLE_URL: `${cloudStub}/google`,
            CLOUD_STUB_YANDEX_URL: `${cloudStub}/yandex`,
            DRIVE_EXPORT_DEADLINE_MS: "20000",
          }
        : {}),
    },
  },
  use: {
    baseURL: siteUrl.origin,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: { width: 1280, height: 900 },
    // Паролей в тестах нет (вход — в globalSetup, без трассы); трасса — только при падении.
    trace: "retain-on-failure",
    video: "off",
    // E2E_SHOTS=1 — снимок в конце каждого теста (проверка оформления состояний, недоступных без данных теста).
    screenshot: process.env.E2E_SHOTS ? "on" : "only-on-failure",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
});
