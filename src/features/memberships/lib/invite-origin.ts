import "server-only";

import { headers } from "next/headers";

/**
 * Адрес сайта для ссылки-приглашения.
 * На боевом сайте — APP_URL. При локальной разработке — адрес, с которого открыт сайт
 * (localhost): иначе ссылка вела бы на боевой сайт с другим кодом.
 */
export async function inviteOrigin(): Promise<string> {
  if (process.env.NODE_ENV !== "production") {
    const requestHeaders = await headers();
    const host = requestHeaders.get("host");
    if (host) {
      const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
      return `${proto}://${host}`;
    }
  }
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
