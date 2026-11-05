/**
 * Миграции на базе e2e. Адрес только из `E2E_DIRECT_URL` в `.env.e2e`, проверка та же, что у e2e.
 * Вдобавок адрес должен быть прямым: адрес через пул даёт отказ.
 *
 *   npm run db:status:e2e    — prisma migrate status
 *   npm run db:migrate:e2e   — prisma migrate deploy
 *
 * Других команд и аргументов нет. Адрес передаётся Prisma через окружение, `.env` его не перетирает.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  e2eDirectUrlProblem,
  e2ePrismaArgs,
  resolveE2EDatabaseEnv,
} from "../src/shared/db/e2e-database-guard";

const PRISMA_CLI = path.join(process.cwd(), "node_modules/prisma/build/index.js");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const prismaArgs = e2ePrismaArgs(process.argv.slice(2));
if (!prismaArgs) fail("Запуск: npm run db:status:e2e или npm run db:migrate:e2e, без других аргументов");

let directUrl = "";
try {
  directUrl = resolveE2EDatabaseEnv().DIRECT_URL;
} catch (error) {
  fail(error instanceof Error ? error.message : "E2E остановлен: база не проверена");
}
const directUrlProblem = e2eDirectUrlProblem(directUrl);
if (directUrlProblem) fail(directUrlProblem);

const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: directUrl, DIRECT_URL: directUrl };
// `prisma.config.ts` грузит `dotenv/config`: `DOTENV_CONFIG_OVERRIDE` дал бы `.env` перетереть адрес.
// Регистр не важен: на Windows `dotenv_config_override` — та же переменная.
for (const name of Object.keys(env)) {
  if (name.toUpperCase().startsWith("DOTENV_CONFIG_")) delete env[name];
}

const result = spawnSync(process.execPath, [PRISMA_CLI, ...prismaArgs], { stdio: "inherit", env });
if (result.error) fail("Не удалось запустить Prisma");
process.exit(result.status ?? 1);
