type PrintImage = {
  complete: boolean;
  addEventListener(type: "load" | "error", listener: () => void, options?: { once?: boolean }): void;
};

type PrintWindow = {
  focus(): void;
  print(): void;
  document: {
    images: ArrayLike<PrintImage>;
    /** Шрифты страницы (`document.fonts`); в старых браузерах может не быть. */
    fonts?: { ready: Promise<unknown> };
    body?: { offsetHeight: number } | null;
  };
};

/** Сколько ждать фото и шрифты перед печатью, если что-то не отвечает. */
export const PRINT_IMAGES_TIMEOUT_MS = 5000;

/**
 * Печать окна, в которое HTML записан через `document.write` (своих скриптов там нет — CSP).
 * `readyState` такого окна в Chromium сразу «complete», поэтому ждём сами:
 * - каждую ещё не готовую картинку — до `load` или `error` (404, недоступный хост);
 * - шрифты — `document.fonts.ready` (шрифт из `data:` картинкой не считается).
 * Не дольше таймаута. Печать вызывается один раз.
 */
export function printWhenImagesSettled(win: PrintWindow, timeoutMs = PRINT_IMAGES_TIMEOUT_MS) {
  const pending = Array.from(win.document.images).filter((img) => !img.complete);
  // Раскладка до чтения `fonts.ready`: шрифты, нужные тексту, начинают грузиться только при ней,
  // а до этого `ready` может быть уже выполнен.
  void win.document.body?.offsetHeight;
  const fontsReady = win.document.fonts?.ready;
  if (pending.length === 0 && !fontsReady) {
    win.focus();
    win.print();
    return;
  }

  let printed = false;
  // Вызывается только из событий картинок, шрифтов и таймера — к этому моменту `timer` уже задан.
  const print = () => {
    if (printed) return;
    printed = true;
    clearTimeout(timer);
    win.focus();
    win.print();
  };
  let left = pending.length + (fontsReady ? 1 : 0);
  const settle = () => {
    left -= 1;
    if (left === 0) print();
  };
  for (const img of pending) {
    img.addEventListener("load", settle, { once: true });
    img.addEventListener("error", settle, { once: true });
  }
  fontsReady?.then(settle, settle);
  const timer = setTimeout(print, timeoutMs);
}

/** Окно печати, в которое пишется HTML с сервера. */
type ServerPrintWindow = PrintWindow & {
  close(): void;
  document: PrintWindow["document"] & { write(html: string): void; close(): void };
};

export const PRINT_POPUP_BLOCKED = "Браузер не открыл окно печати — разрешите всплывающие окна";
export const PRINT_FAILED = "Не удалось подготовить лист к печати — попробуйте ещё раз";

/** Пока сервер собирает лист — в окне эта строка (без скриптов). */
const PRINT_WAIT_HTML =
  '<!doctype html><meta charset="utf-8"><title>Печать</title>' +
  '<p style="font:14px sans-serif;margin:24px">Готовим лист к печати…</p>';

/** Новая пустая вкладка своего сайта (без `noopener`: с ним `window.open` возвращает `null`). */
export function openPrintWindow(): ServerPrintWindow | null {
  return window.open("", "_blank");
}

/** Ответ сервера для окна печати: HTML (и предупреждение, например «фото не загрузились») или ошибка. */
export type ServerPrintHtml = { html: string; warning?: string } | { error: string };

/**
 * Печать HTML, который собирает сервер. Окно открывается сразу, до первого `await`:
 * браузер разрешает всплывающее окно только в обработчике клика (Safari — строго синхронно,
 * Chrome — несколько секунд после клика). Потом в окно пишется HTML. Ошибка сервера
 * (ответ `{ error }` или исключение) — окно закрывается, вызывающий показывает сообщение.
 * Вызывать прямо из обработчика клика (или из `startTransition` в нём) — без `await` до вызова.
 * `print: false` — только открыть страницу (печатает сам пользователь).
 */
export async function printServerHtml(
  openWindow: () => ServerPrintWindow | null,
  load: () => Promise<ServerPrintHtml>,
  options: { print?: boolean } = {},
): Promise<{ error?: string; warning?: string }> {
  const win = openWindow();
  if (!win) return { error: PRINT_POPUP_BLOCKED };
  win.document.write(PRINT_WAIT_HTML);
  win.document.close();
  let result: ServerPrintHtml;
  try {
    result = await load();
  } catch {
    win.close();
    return { error: PRINT_FAILED };
  }
  if ("error" in result) {
    win.close();
    return { error: result.error };
  }
  win.document.write(result.html);
  win.document.close();
  if (options.print === false) win.focus();
  // Скрипты в странице печати запрещены (CSP) — печать вызывается отсюда.
  else printWhenImagesSettled(win);
  return result.warning ? { warning: result.warning } : {};
}

/**
 * Ответ выгрузки «файл или печать» (`{ error }`, `{ base64 … }`, `{ html … }`) — в ответ для
 * окна печати: HTML нет — ошибка (окно закроется).
 */
export function asPrintHtml(result: object): ServerPrintHtml {
  const r = result as { error?: unknown; html?: unknown; warning?: unknown };
  if (typeof r.error === "string" && r.error) return { error: r.error };
  if (typeof r.html !== "string" || !r.html) return { error: PRINT_FAILED };
  return typeof r.warning === "string" && r.warning ? { html: r.html, warning: r.warning } : { html: r.html };
}

/** Печать выгрузки: новое окно по клику, HTML — из ответа серверного действия. */
export function printExport(
  load: () => Promise<object>,
  options?: { print?: boolean },
): Promise<{ error?: string; warning?: string }> {
  return printServerHtml(openPrintWindow, async () => asPrintHtml(await load()), options);
}
