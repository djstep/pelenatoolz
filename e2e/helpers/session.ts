import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Download, Page, Response } from "@playwright/test";
import type { E2ERoleKey } from "../fixtures/data";
import type { E2EContext } from "./db";

export function storageStatePath(role: E2ERoleKey) {
  return path.join(__dirname, "..", ".auth", `${role}.json`);
}

/** Id проекта и дней — записывает globalSetup. */
export function e2eContext(): E2EContext {
  return JSON.parse(readFileSync(path.join(__dirname, "..", ".auth", "context.json"), "utf8"));
}

export function dayId(ctx: E2EContext, dayNumber: number) {
  const day = ctx.days.find((d) => d.dayNumber === dayNumber);
  if (!day) throw new Error(`Нет дня ${dayNumber}`);
  return day.id;
}

export const projectPath = (ctx: E2EContext, rest = "") => `/ru/projects/${ctx.projectId}${rest}`;

export type Captured = { url: string; type: string; body: string };

const TEXT_TYPES = ["text/html", "text/x-component", "application/json", "text/plain"];

/**
 * Все текстовые ответы своего сайта, пока открыта страница: документ, `?_rsc`, ответы
 * серверных действий. Статику (`/_next/static`, шрифты, картинки) не берём.
 */
export function sniff(page: Page) {
  const captured: Captured[] = [];
  const pending: Promise<void>[] = [];
  const origin = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;
  const onResponse = (res: Response) => {
    const url = res.url();
    if (!url.startsWith(origin) || url.includes("/_next/static/") || url.includes("/__nextjs")) return;
    const type = res.headers()["content-type"] ?? "";
    if (!TEXT_TYPES.some((t) => type.startsWith(t))) return;
    pending.push(
      res
        .text()
        .then((body) => void captured.push({ url, type, body }))
        .catch(() => undefined),
    );
  };
  page.on("response", onResponse);
  return {
    captured,
    async done() {
      await Promise.all(pending);
      page.off("response", onResponse);
      return captured;
    },
  };
}

/** Ответ страницы в формате RSC (как при переходе по ссылке внутри сайта). */
export async function fetchRsc(page: Page, url: string) {
  const sep = url.includes("?") ? "&" : "?";
  const res = await page.request.get(`${url}${sep}_rsc=e2e`, { headers: { RSC: "1" } });
  return { status: res.status(), type: res.headers()["content-type"] ?? "", body: await res.text() };
}

/** Скачанный файл целиком. */
export async function downloadBuffer(download: Download) {
  return readFile(await download.path());
}
