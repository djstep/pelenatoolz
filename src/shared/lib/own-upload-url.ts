import { isSitePath } from "@/shared/lib/escape-html";

/**
 * Свои загрузки хранятся и выводятся только путём сайта `/uploads/<проект>/<имя>`:
 * браузер берёт файл с того же сайта, на котором открыт, а домен меняется при переезде.
 * Полный адрес своего сайта (APP_URL, NEXTAUTH_URL, *.vercel.app, localhost) с путём
 * `/uploads/...` → этот путь. Любой другой адрес — без изменений (только обрезка пробелов).
 */
export function toOwnUploadPath(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed;
  if (!isOwnHost(url.hostname)) return trimmed;
  const { pathname } = url;
  if (!pathname.startsWith("/uploads/") || !isSitePath(pathname)) return trimmed;
  return pathname;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isOwnHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) return true;
  if (host.endsWith(".vercel.app")) return true;
  return envHosts().includes(host);
}

function envHosts(): string[] {
  const hosts: string[] = [];
  for (const raw of [process.env.APP_URL, process.env.NEXTAUTH_URL]) {
    if (!raw) continue;
    try {
      hosts.push(new URL(raw).hostname.toLowerCase());
    } catch {
      // неверный адрес в настройках — пропуск
    }
  }
  return hosts;
}
