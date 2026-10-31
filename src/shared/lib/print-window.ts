type PrintImage = {
  complete: boolean;
  addEventListener(type: "load" | "error", listener: () => void, options?: { once?: boolean }): void;
};

type PrintWindow = {
  focus(): void;
  print(): void;
  document: { images: ArrayLike<PrintImage> };
};

/** Сколько ждать фото перед печатью, если хост не отвечает. */
export const PRINT_IMAGES_TIMEOUT_MS = 5000;

/**
 * Печать окна, в которое HTML записан через `document.write` (своих скриптов там нет — CSP).
 * `readyState` такого окна в Chromium сразу «complete», поэтому ждём сами картинки:
 * каждая ещё не готовая — до `load` или `error` (404, недоступный хост), но не дольше таймаута.
 * Печать вызывается один раз.
 */
export function printWhenImagesSettled(win: PrintWindow, timeoutMs = PRINT_IMAGES_TIMEOUT_MS) {
  const pending = Array.from(win.document.images).filter((img) => !img.complete);
  if (pending.length === 0) {
    win.focus();
    win.print();
    return;
  }

  let printed = false;
  // Вызывается только из событий картинок и таймера — к этому моменту `timer` уже задан.
  const print = () => {
    if (printed) return;
    printed = true;
    clearTimeout(timer);
    win.focus();
    win.print();
  };
  let left = pending.length;
  const settle = () => {
    left -= 1;
    if (left === 0) print();
  };
  for (const img of pending) {
    img.addEventListener("load", settle, { once: true });
    img.addEventListener("error", settle, { once: true });
  }
  const timer = setTimeout(print, timeoutMs);
}
