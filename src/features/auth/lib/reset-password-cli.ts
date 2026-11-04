import { randomBytes } from "node:crypto";
import { passwordProblem } from "@/features/auth/lib/password-rules";

const PROD_HOST_MARK = "ep-steep-sound";

export const USAGE = "Запуск: npm run user:reset-password -- <почта> [--prod]";

export type ResetPasswordArgs = { email: string; prod: boolean };

/** Разбор командной строки. Пароль здесь не принимается: он остался бы в истории команд. */
export function parseResetPasswordArgs(argv: string[]): ResetPasswordArgs | { error: string } {
  const flags = argv.filter((arg) => arg.startsWith("--"));
  const positional = argv.filter((arg) => !arg.startsWith("--"));

  const unknown = flags.find((flag) => flag !== "--prod");
  if (unknown) return { error: `Неизвестный флаг ${unknown}. ${USAGE}` };
  if (positional.length > 1) {
    return { error: `Пароль в командной строке не принимается, он генерируется сам. ${USAGE}` };
  }
  const email = positional[0]?.trim().toLowerCase();
  if (!email || !email.includes("@")) return { error: USAGE };
  return { email, prod: flags.includes("--prod") };
}

export function databaseHost(url: string): string {
  return url.match(/@([^/?:]+)/)?.[1] ?? "?";
}

/**
 * Можно ли работать с этой базой. Смотрим обе строки из `.env`: хватит одной на прод.
 * `--prod` на базе, которая не прод, тоже отказ: значит, запускавший ошибся, где находится.
 */
export function databaseProblem(urls: (string | undefined)[], prodFlag: boolean): string | null {
  const present = urls.filter((url): url is string => Boolean(url));
  if (present.length === 0) return "В файле .env нет DATABASE_URL: скрипт работает только с базой из .env";
  const isProd = present.some((url) => url.includes(PROD_HOST_MARK));
  if (isProd && !prodFlag) {
    return `База из .env — прод (${PROD_HOST_MARK}…). Чтобы сбросить пароль на проде, добавьте флаг --prod`;
  }
  if (!isProd && prodFlag) {
    return "Указан --prod, но база из .env не прод. Проверьте .env и уберите флаг";
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
