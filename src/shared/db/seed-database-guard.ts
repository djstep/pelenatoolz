/**
 * Базы, где можно запускать сид тестовых данных. Только эти: новая база, в том числе прод после
 * переезда на VPS, получит отказ, пока её не внесут сюда осознанно. Имя узла Neon без `-pooler`:
 * у одной базы два адреса, прямой и через пул.
 */
export const SEED_DATABASE_ENDPOINTS = [
  // dev. Сам `scripts/e2e-seed.ts` сюда не попадёт: он идёт только в базу из `.env.e2e`
  "ep-floral-bread-zabr5sop",
  // отдельная e2e-ветка (`E2E_DATABASE_URL` в `.env.e2e`)
  "ep-wispy-unit-za418ey3",
] as const;

const NEON_HOST_SUFFIX = ".neon.tech";

/** Имя сервера из строки подключения. Только оно: логин, пароль и параметры не считаются. */
export function databaseHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Имя узла Neon без `-pooler`; не Neon — `null`. */
export function neonEndpoint(host: string): string | null {
  if (!host.endsWith(NEON_HOST_SUFFIX)) return null;
  return host.split(".")[0].replace(/-pooler$/, "");
}

function isSeedDatabaseHost(host: string): boolean {
  const endpoint = neonEndpoint(host);
  return endpoint !== null && (SEED_DATABASE_ENDPOINTS as readonly string[]).includes(endpoint);
}

/**
 * Можно ли запускать сид. Проверяются обе строки подключения: хватит одной чужой. `DIRECT_URL`
 * может не быть, `DATABASE_URL` обязателен. Текст ошибки только с именем сервера: паролей в нём нет.
 */
export function seedDatabaseProblem(env: {
  DATABASE_URL?: string;
  DIRECT_URL?: string;
}): string | null {
  if (!env.DATABASE_URL) return "Сид остановлен: DATABASE_URL не задан";
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const url = env[name];
    if (!url) continue;
    const host = databaseHost(url);
    if (!host) return `Сид остановлен: не удалось разобрать адрес базы в ${name}`;
    if (!isSeedDatabaseHost(host)) {
      return (
        `Сид остановлен: база ${host} из ${name} не в списке тестовых баз. ` +
        "Список — SEED_DATABASE_ENDPOINTS в src/shared/db/seed-database-guard.ts"
      );
    }
  }
  return null;
}
