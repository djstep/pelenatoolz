/**
 * Какая база у приложения (`.env`) и у e2e (`E2E_DATABASE_URL` в `.env.e2e`): только хост и имя базы.
 * Пользователь, пароль и остальная строка подключения не выводятся.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

function describeDatabase(url: string | undefined, name: string) {
  if (!url) return `${name} не задан`;
  try {
    const { hostname, pathname } = new URL(url);
    return `${hostname} / ${pathname.slice(1)}`;
  } catch {
    return "адрес не разбирается";
  }
}

function readEnvFile(file: string): Record<string, string> {
  const fullPath = path.join(process.cwd(), file);
  return existsSync(fullPath) ? parse(readFileSync(fullPath)) : {};
}

if (process.env.DATABASE_URL) {
  console.log(`окружение: ${describeDatabase(process.env.DATABASE_URL, "DATABASE_URL")}`);
}

console.log(`.env: ${describeDatabase(readEnvFile(".env").DATABASE_URL, "DATABASE_URL")}`);
console.log(`e2e (.env.e2e): ${describeDatabase(readEnvFile(".env.e2e").E2E_DATABASE_URL, "E2E_DATABASE_URL")}`);
