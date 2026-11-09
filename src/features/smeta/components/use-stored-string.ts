"use client";

import { useCallback, useSyncExternalStore } from "react";

const EVENT = "smeta-stored-string";
/** Запасная память на время вкладки, если память браузера недоступна. */
const memory = new Map<string, string>();

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

/**
 * Строка в памяти браузера (свёрнутые уровни, видимые колонки). null — ещё не задавали;
 * на сервере и до загрузки в браузере — тоже null.
 */
export function useStoredString(storageKey: string) {
  const value = useSyncExternalStore(subscribe, () => read(storageKey), () => null);
  const set = useCallback(
    (next: string) => {
      write(storageKey, next);
      window.dispatchEvent(new Event(EVENT));
    },
    [storageKey],
  );
  return [value, set] as const;
}
