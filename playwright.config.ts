import "./e2e/helpers/use-e2e-database";
import { defineConfig, devices } from "@playwright/test";

/**
 * Приёмочные тесты (`e2e/`): база только из `E2E_DATABASE_URL` и `E2E_DIRECT_URL` в `.env.e2e`.
 * Запуск — `npm run e2e` (сид проекта «E2E приёмка», затем тесты).
 * Сайт на эту же базу поднимает сам Playwright: уже занятый порт — ошибка, чужой сайт не подойдёт.
 * Адрес сайта — `E2E_BASE_URL` (по умолчанию http://localhost:3100), только на этой машине.
 * `E2E_CLOUD_STUB_URL` — заглушка дисков для сайта и тестов (`global-setup.ts`), по умолчанию порт 4510.
 *
 * Группы файлов:
 *   read  — только читают данные, идут параллельно;
 *   write — меняют общий проект, идут по очереди и только после `read`: новый файл попадает сюда;
 *   drive — Диск, `npm run e2e:drive`: одна заглушка на всех, `reset` в одном файле стирает другой.
 * Упал файл из `read` — `write` не идёт, это правило Playwright. Запустить `write` без `read`
 * и один файл без остальных: `npm run e2e -- --no-deps c15`.
 */
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

// До чтения в спеках и в рабочих процессах Playwright: они загружают этот же файл.
process.env.E2E_BASE_URL ??= "http://localhost:3100";
const siteUrl = new URL(process.env.E2E_BASE_URL);
if (!LOCAL_HOSTS.includes(siteUrl.hostname)) {
  throw new Error(`E2E остановлен: сайт ${siteUrl.hostname} не на этой машине, его база не проверяется`);
}
// Заглушка всегда: без неё файлы Диска молча пропускаются, и `e2e:drive` был бы зелёным впустую.
process.env.E2E_CLOUD_STUB_URL ||= "http://127.0.0.1:4510";
const cloudStub = process.env.E2E_CLOUD_STUB_URL.trim().replace(/\/+$/, "");

const specs = (...prefixes: string[]) => prefixes.map((prefix) => `**/${prefix}-*.spec.ts`);
const READ_ONLY_SPECS = specs("a0", "a1", "a2", "c2", "c7", "d1", "d2");
const DRIVE_SPECS = specs("c3", "c4", "c5", "c6", "c9", "c10", "c11", "c12");
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } };

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./e2e/global-setup.ts",
  // Предел на весь прогон. Группы, где файлы мешают друг другу, ограничены одним потоком ниже.
  workers: 4,
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
      CLOUD_STUB_GOOGLE_URL: `${cloudStub}/google`,
      CLOUD_STUB_YANDEX_URL: `${cloudStub}/yandex`,
      DRIVE_EXPORT_DEADLINE_MS: "20000",
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
  projects: [
    { name: "read", testMatch: READ_ONLY_SPECS, use: desktop },
    { name: "write", testIgnore: [...READ_ONLY_SPECS, ...DRIVE_SPECS], dependencies: ["read"], workers: 1, use: desktop },
    { name: "drive", testMatch: DRIVE_SPECS, workers: 1, use: desktop },
  ],
});
