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
