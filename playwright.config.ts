import { defineConfig, devices } from "@playwright/test";

/**
 * Приёмочные тесты (`e2e/`): против запущенного `npm run dev` и ветки базы e2e.
 * Запуск — `npm run e2e` (сид проекта «E2E приёмка», затем тесты).
 * Адрес сайта — `E2E_BASE_URL` (по умолчанию http://localhost:3000).
 */
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
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: { width: 1280, height: 900 },
    // Паролей в тестах нет (вход — в globalSetup, без трассы); трасса — только при падении.
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
});
