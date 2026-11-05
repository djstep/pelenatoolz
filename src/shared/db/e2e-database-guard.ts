import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { databaseHost, neonEndpoint } from "./seed-database-guard";

/**
 * Базы, куда может идти e2e. Только эти: новая ветка получит отказ, пока её не внесут сюда
 * осознанно. Имя узла Neon без `-pooler`: у одной базы два адреса, прямой и через пул.
 */
export const E2E_DATABASE_ENDPOINTS = ["ep-wispy-unit-za418ey3"] as const;

const E2E_ENV_FILE = ".env.e2e";
const APP_ENV_FILE = ".env";

type E2EDatabaseUrls = { E2E_DATABASE_URL?: string; E2E_DIRECT_URL?: string };
type AppDatabaseUrls = { DATABASE_URL?: string; DIRECT_URL?: string };

/**
 * Можно ли запускать e2e. Обе строки из `.env.e2e` обязательны и обе должны вести на базу из списка,
 * не ту, что в `.env`. Отката на `.env` нет. Текст ошибки только с именем сервера: паролей в нём нет.
 */
export function e2eDatabaseProblem(e2e: E2EDatabaseUrls, app: AppDatabaseUrls): string | null {
  const endpoints: string[] = [];
  for (const name of ["E2E_DATABASE_URL", "E2E_DIRECT_URL"] as const) {
    const url = e2e[name];
    if (!url) {
      return `E2E остановлен: в ${E2E_ENV_FILE} нет ${name}. База из ${APP_ENV_FILE} для e2e не используется`;
    }
    const host = databaseHost(url);
    if (!host) return `E2E остановлен: не удалось разобрать адрес базы в ${name}`;
    const endpoint = neonEndpoint(host);
    if (!endpoint || !(E2E_DATABASE_ENDPOINTS as readonly string[]).includes(endpoint)) {
      return (
        `E2E остановлен: база ${host} из ${name} не в списке баз e2e. ` +
        "Список — E2E_DATABASE_ENDPOINTS в src/shared/db/e2e-database-guard.ts"
      );
    }
    endpoints.push(endpoint);
  }

  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const url = app[name];
    if (!url) continue;
    const host = databaseHost(url);
    if (!host) return `E2E остановлен: не удалось разобрать адрес базы в ${name} из ${APP_ENV_FILE}`;
    const endpoint = neonEndpoint(host);
    if (endpoint && endpoints.includes(endpoint)) {
      return `E2E остановлен: база ${host} совпадает с ${name} из ${APP_ENV_FILE}. У e2e должна быть своя база`;
    }
  }
  return null;
}

function readEnvFile(file: string): Record<string, string> {
  return existsSync(file) ? parse(readFileSync(file)) : {};
}

/** Адреса базы e2e для процесса. Читаем сами файлы: значения из окружения оболочки не считаются. */
export function resolveE2EDatabaseEnv(root: string = process.cwd()) {
  const e2e: E2EDatabaseUrls = readEnvFile(path.join(root, E2E_ENV_FILE));
  const problem = e2eDatabaseProblem(e2e, readEnvFile(path.join(root, APP_ENV_FILE)));
  if (problem) throw new Error(problem);
  return { DATABASE_URL: e2e.E2E_DATABASE_URL as string, DIRECT_URL: e2e.E2E_DIRECT_URL as string };
}

/**
 * Те ли адреса в окружении процесса, что подставлены для e2e. Звать после загрузки `.env`: например,
 * `DOTENV_CONFIG_OVERRIDE=true` даёт `dotenv/config` перетереть базу e2e. Адресов в тексте нет.
 */
export function e2eDatabaseEnvProblem(current: AppDatabaseUrls, expected: AppDatabaseUrls): string | null {
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    if (current[name] !== expected[name]) {
      return `E2E остановлен: ${name} в окружении процесса не совпадает с базой e2e из ${E2E_ENV_FILE}`;
    }
  }
  return null;
}

/**
 * Подставить базу e2e в `DATABASE_URL` / `DIRECT_URL`. Звать до загрузки клиента базы. Заданные
 * здесь значения `dotenv`, Next и Prisma не перезаписывают: `.env` дальше даёт только остальное.
 */
export function applyE2EDatabaseEnv() {
  Object.assign(process.env, resolveE2EDatabaseEnv());
}
