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

/**
 * Базы локального Postgres. Сервер у них один, поэтому база определяется ещё и по имени:
 * другая база на этой машине, в том числе копия прода, получит отказ. Порт не проверяется:
 * установщик может выдать не 5432.
 */
export const LOCAL_DEV_DATABASE = "pelena_dev";
export const LOCAL_E2E_DATABASE = "pelena_e2e";

const NEON_HOST_SUFFIX = ".neon.tech";
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
/** Эти параметры подменяют сервер из адреса, поэтому такой адрес локальным не считается. */
const HOST_OVERRIDE_PARAMS = ["host", "hostaddr"];

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

/** Путь из адреса: для Postgres это имя базы. Адрес не разбирается — `null`. */
function databasePath(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).pathname.slice(1)) || null;
  } catch {
    return null;
  }
}

/** Адрес ведёт на эту машину, в одну из перечисленных баз, и сервер не подменён параметрами. */
export function isLocalDatabase(url: string, names: readonly string[]): boolean {
  const name = databasePath(url);
  if (!name || !names.includes(name)) return false;
  const parsed = new URL(url);
  if (!LOCAL_HOSTS.includes(parsed.hostname.toLowerCase())) return false;
  return !HOST_OVERRIDE_PARAMS.some((param) => parsed.searchParams.has(param));
}

/**
 * Чем база отличается от других: узел Neon, а вне Neon — имя базы без учёта сервера. На одну машину
 * ведёт много адресов (`[::1]`, `127.0.0.2`, имя компьютера), поэтому сервер здесь не сравниваем:
 * лишний отказ безопаснее, чем e2e в чужой базе.
 */
export function databaseIdentity(url: string): string | null {
  const host = databaseHost(url);
  const endpoint = host ? neonEndpoint(host) : null;
  if (endpoint) return endpoint;
  const name = databasePath(url)?.split("/")[0].toLowerCase();
  return name ? `name/${name}` : null;
}

function isSeedDatabase(url: string, host: string): boolean {
  const endpoint = neonEndpoint(host);
  if (endpoint !== null) return (SEED_DATABASE_ENDPOINTS as readonly string[]).includes(endpoint);
  return isLocalDatabase(url, [LOCAL_DEV_DATABASE, LOCAL_E2E_DATABASE]);
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
    if (!isSeedDatabase(url, host)) {
      return (
        `Сид остановлен: база ${host} из ${name} не в списке тестовых баз. ` +
        "Список — SEED_DATABASE_ENDPOINTS и локальные базы в src/shared/db/seed-database-guard.ts"
      );
    }
  }
  return null;
}
