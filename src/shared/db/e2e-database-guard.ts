import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import {
  databaseHost,
  databaseIdentity,
  isLocalDatabase,
  LOCAL_E2E_DATABASE,
  neonEndpoint,
} from "./seed-database-guard";

/**
 * Базы, куда может идти e2e. Только эти и локальная `LOCAL_E2E_DATABASE`: новая ветка получит отказ,
 * пока её не внесут сюда осознанно. Имя узла Neon без `-pooler`: у одной базы два адреса, прямой и
 * через пул.
 */
export const E2E_DATABASE_ENDPOINTS = ["ep-wispy-unit-za418ey3"] as const;

const E2E_ENV_FILE = ".env.e2e";
const APP_ENV_FILE = ".env";

type E2EDatabaseUrls = { E2E_DATABASE_URL?: string; E2E_DIRECT_URL?: string };
type AppDatabaseUrls = { DATABASE_URL?: string; DIRECT_URL?: string };

function isE2EDatabase(url: string, host: string): boolean {
  const endpoint = neonEndpoint(host);
  if (endpoint !== null) return (E2E_DATABASE_ENDPOINTS as readonly string[]).includes(endpoint);
  return isLocalDatabase(url, [LOCAL_E2E_DATABASE]);
}

/**
 * Можно ли запускать e2e. Обе строки из `.env.e2e` обязательны и обе должны вести на базу из списка,
 * не ту, что в `.env`. Отката на `.env` нет. Текст ошибки только с именем сервера: паролей в нём нет.
 */
export function e2eDatabaseProblem(e2e: E2EDatabaseUrls, app: AppDatabaseUrls): string | null {
  const identities: (string | null)[] = [];
  for (const name of ["E2E_DATABASE_URL", "E2E_DIRECT_URL"] as const) {
    const url = e2e[name];
    if (!url) {
      return `E2E остановлен: в ${E2E_ENV_FILE} нет ${name}. База из ${APP_ENV_FILE} для e2e не используется`;
    }
    const host = databaseHost(url);
    if (!host) return `E2E остановлен: не удалось разобрать адрес базы в ${name}`;
    if (!isE2EDatabase(url, host)) {
      return (
        `E2E остановлен: база ${host} из ${name} не в списке баз e2e. ` +
        "Список — E2E_DATABASE_ENDPOINTS в src/shared/db/e2e-database-guard.ts и локальная база e2e"
      );
    }
    identities.push(databaseIdentity(url));
  }
  // Разрешённых баз две: миграции шли бы в одну (`E2E_DIRECT_URL`), а сид и сайт работали бы на другой.
  if (identities[0] !== identities[1]) {
    return `E2E остановлен: E2E_DATABASE_URL и E2E_DIRECT_URL в ${E2E_ENV_FILE} ведут в разные базы`;
  }

  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const url = app[name];
    if (!url) continue;
    const host = databaseHost(url);
    if (!host) return `E2E остановлен: не удалось разобрать адрес базы в ${name} из ${APP_ENV_FILE}`;
    const identity = databaseIdentity(url);
    if (identity && identities.includes(identity)) {
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

const E2E_PRISMA_COMMANDS = new Map([
  ["status", ["migrate", "status"]],
  ["migrate", ["migrate", "deploy"]],
]);

/**
 * Аргументы Prisma для `scripts/db-e2e.ts`: ровно одна команда из двух. Посторонние аргументы —
 * `null`: через этот скрипт на базу e2e идёт только то, что перечислено здесь.
 */
export function e2ePrismaArgs(argv: string[]): string[] | null {
  if (argv.length !== 1) return null;
  return E2E_PRISMA_COMMANDS.get(argv[0]) ?? null;
}

/**
 * Подходит ли `E2E_DIRECT_URL` для миграций: они идут только по прямому адресу, не через пул.
 * Адреса в тексте нет.
 */
export function e2eDirectUrlProblem(directUrl: string): string | null {
  const host = databaseHost(directUrl);
  if (!host) return "Миграции остановлены: не удалось разобрать адрес базы в E2E_DIRECT_URL";
  if (host.split(".")[0].endsWith("-pooler")) {
    return `Миграции остановлены: E2E_DIRECT_URL в ${E2E_ENV_FILE} идёт через пул. Нужен прямой адрес, без -pooler`;
  }
  return null;
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
