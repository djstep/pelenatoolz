"use client";

import { useCallback, useMemo } from "react";
import { useStoredString } from "@/features/smeta/components/use-stored-string";

/**
 * Свёрнутые уровни сметы (id статей и подстатей) — в памяти браузера, у каждого свои.
 * До загрузки в браузере всё развёрнуто, как на сервере.
 */
export function useCollapsedIds(storageKey: string) {
  const [raw, write] = useStoredString(storageKey);
  const collapsed = useMemo(() => new Set(raw ? raw.split(",") : []), [raw]);
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(collapsed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      write([...next].join(","));
    },
    [collapsed, write],
  );
  return [collapsed, toggle] as const;
}
