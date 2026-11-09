"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const EVENT = "smeta-items-collapsed";
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

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return memory.get(key) ?? "";
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
 * Свёрнутые уровни сметы (id статей и подстатей) — в памяти браузера, у каждого свои.
 * До загрузки в браузере всё развёрнуто, как на сервере.
 */
export function useCollapsedIds(storageKey: string) {
  const raw = useSyncExternalStore(subscribe, () => read(storageKey), () => "");
  const collapsed = useMemo(() => new Set(raw ? raw.split(",") : []), [raw]);
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      write(storageKey, [...next].join(","));
      window.dispatchEvent(new Event(EVENT));
    },
    [collapsed, storageKey],
  );
  return [collapsed, toggle] as const;
}
