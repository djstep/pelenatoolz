import { randomBytes } from "node:crypto";
import { passwordProblem } from "@/features/auth/lib/password-rules";

/** Старый прод в Neon. */
const PROD_HOST_MARK = "ep-steep-sound";
/** Прод на сервере: база в Docker, имя службы из docker-compose.prod.yml. */
const PROD_DOCKER_HOST = "db";

export const USAGE = "Запуск: npm run user:reset-password -- <почта> [--env-file <файл>] [--prod]";

export const DEFAULT_ENV_FILE = ".env";

export type ResetPasswordArgs = { email: string; prod: boolean; envFile: string };

/** Разбор командной строки. Пароль здесь не принимается: он остался бы в истории команд. */
export function parseResetPasswordArgs(argv: string[]): ResetPasswordArgs | { error: string } {
  const positional: string[] = [];
  let prod = false;
  let envFile: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--prod") {
      prod = true;
    } else if (arg === "--env-file" || arg.startsWith("--env-file=")) {
      if (envFile !== undefined) return { error: `--env-file указан дважды. ${USAGE}` };
      const value = arg === "--env-file" ? argv[(i += 1)] : arg.slice("--env-file=".length);
      if (!value || value.startsWith("--")) return { error: `После --env-file нужен путь к файлу. ${USAGE}` };
      envFile = value;
    } else if (arg.startsWith("--")) {
      return { error: `Неизвестный флаг ${arg}. ${USAGE}` };
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    return { error: `Пароль в командной строке не принимается, он генерируется сам. ${USAGE}` };
  }
  const email = positional[0]?.trim().toLowerCase();
  if (!email || !email.includes("@")) return { error: USAGE };
  return { email, prod, envFile: envFile ?? DEFAULT_ENV_FILE };
}

export function databaseHost(url: string): string {
  return url.match(/@([^/?:]+)/)?.[1] ?? "?";
}

/**
 * Можно ли работать с этой базой. Смотрим обе строки из файла: хватит одной на прод.
 * `--prod` на базе, которая не прод, тоже отказ: значит, запускавший ошибся, где находится.
 */
export function databaseProblem(
  urls: (string | undefined)[],
  prodFlag: boolean,
  envFile: string = DEFAULT_ENV_FILE,
): string | null {
  const present = urls.filter((url): url is string => Boolean(url));
  const databaseUrl = urls[0];
  if (!databaseUrl) return `В файле ${envFile} нет DATABASE_URL: скрипт работает только с базой из этого файла`;
  const isProd = present.some((url) => url.includes(PROD_HOST_MARK) || databaseHost(url) === PROD_DOCKER_HOST);
  if (isProd && !prodFlag) {
    return `База из ${envFile} — прод. Чтобы сбросить пароль на проде, добавьте флаг --prod`;
  }
  if (!isProd && prodFlag) {
    return `Указан --prod, но база из ${envFile} не прод. Проверьте файл и уберите флаг`;
  }
  return null;
}

/** Новый пароль: 24 случайных символа. Проходит те же правила, что и пароль, придуманный человеком. */
export function generatePassword(email: string): string {
  for (;;) {
    const password = randomBytes(18).toString("base64url");
    if (!passwordProblem(password, email)) return password;
  }
}
