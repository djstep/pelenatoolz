/**
 * Какая база указана в `.env` и `.env.e2e`: только хост и имя базы.
 * Пользователь, пароль и остальная строка подключения не выводятся.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

function describeDatabase(url: string | undefined) {
  if (!url) return "DATABASE_URL не задан";
  try {
    const { hostname, pathname } = new URL(url);
    return `${hostname} / ${pathname.slice(1)}`;
  } catch {
    return "адрес не разбирается";
  }
}

if (process.env.DATABASE_URL) {
  console.log(`окружение: ${describeDatabase(process.env.DATABASE_URL)}`);
}

for (const file of [".env", ".env.e2e"]) {
  const fullPath = path.join(process.cwd(), file);
  if (!existsSync(fullPath)) continue;
  console.log(`${file}: ${describeDatabase(parse(readFileSync(fullPath)).DATABASE_URL)}`);
}
