"use client";

import { useCallback, useEffect, useState } from "react";

export type ColumnDef = {
  id: string;
  label: string;
  defaultWidth: number;
  minWidth?: number;
};

const STORAGE_PREFIX = "filmprod-table-layout";

export function useTableLayout(
  tableKey: string,
  columns: ColumnDef[],
) {
  const storageKey = `${STORAGE_PREFIX}:${tableKey}`;

  const [visibleIds, setVisibleIds] = useState<Set<string>>(
    () => new Set(columns.map((c) => c.id)),
  );
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((c) => [c.id, c.defaultWidth])),
  );
  const [colorMode, setColorMode] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const data = JSON.parse(raw) as {
          visibleIds?: string[];
          widths?: Record<string, number>;
          colorMode?: boolean;
        };
        if (data.visibleIds?.length) {
          setVisibleIds(new Set(data.visibleIds));
        }
        if (data.widths) {
          setWidths((prev) => ({ ...prev, ...data.widths }));
        }
        if (typeof data.colorMode === "boolean") {
          setColorMode(data.colorMode);
        }
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        visibleIds: Array.from(visibleIds),
        widths,
        colorMode,
      }),
    );
  }, [visibleIds, widths, colorMode, loaded, storageKey]);

  const startResize = useCallback(
    (columnId: string, startX: number) => {
      const startWidth = widths[columnId] ?? 120;
      const col = columns.find((c) => c.id === columnId);
      const minW = col?.minWidth ?? 60;

      function onMove(e: MouseEvent) {
        const next = Math.max(minW, startWidth + e.clientX - startX);
        setWidths((prev) => ({ ...prev, [columnId]: next }));
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [widths, columns],
  );

  return {
    visibleIds,
    setVisibleIds,
    widths,
    colorMode,
    setColorMode,
    startResize,
    visibleColumns: columns.filter((c) => visibleIds.has(c.id)),
  };
}
