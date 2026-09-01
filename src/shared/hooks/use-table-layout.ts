"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type ColumnDef = {
  id: string;
  label: string;
  defaultWidth: number;
  minWidth?: number;
};

const STORAGE_PREFIX = "filmprod-table-layout";

function mergeColumnOrder(stored: string[] | undefined, columns: ColumnDef[]): string[] {
  const ids = columns.map((c) => c.id);
  const remaining = new Set(ids);
  const ordered: string[] = [];

  if (stored) {
    for (const id of stored) {
      if (remaining.has(id)) {
        ordered.push(id);
        remaining.delete(id);
      }
    }
  }

  for (const id of ids) {
    if (remaining.has(id)) ordered.push(id);
  }

  return ordered;
}

export function useTableLayout(tableKey: string, columns: ColumnDef[]) {
  const storageKey = `${STORAGE_PREFIX}:${tableKey}`;

  const [visibleIds, setVisibleIds] = useState<Set<string>>(
    () => new Set(columns.map((c) => c.id)),
  );
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    columns.map((c) => c.id),
  );
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((c) => [c.id, c.defaultWidth])),
  );
  const [colorMode, setColorMode] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setColumnOrder((prev) => mergeColumnOrder(prev, columns));
    setWidths((prev) => {
      const next = { ...prev };
      for (const col of columns) {
        if (next[col.id] == null) next[col.id] = col.defaultWidth;
      }
      return next;
    });
  }, [columns]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const data = JSON.parse(raw) as {
          visibleIds?: string[];
          columnOrder?: string[];
          widths?: Record<string, number>;
          colorMode?: boolean;
        };
        if (data.visibleIds?.length) {
          setVisibleIds(new Set(data.visibleIds));
        }
        if (data.columnOrder?.length) {
          setColumnOrder(mergeColumnOrder(data.columnOrder, columns));
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
  }, [storageKey, columns]);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        visibleIds: Array.from(visibleIds),
        columnOrder,
        widths,
        colorMode,
      }),
    );
  }, [visibleIds, columnOrder, widths, colorMode, loaded, storageKey]);

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

  const reorderColumns = useCallback((activeId: string, overId: string) => {
    setColumnOrder((prev) => {
      const oldIndex = prev.indexOf(activeId);
      const newIndex = prev.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return prev;
      const next = [...prev];
      const [item] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, item!);
      return next;
    });
  }, []);

  const columnMap = useMemo(
    () => new Map(columns.map((c) => [c.id, c] as const)),
    [columns],
  );

  const orderedColumns = useMemo(
    () =>
      columnOrder
        .map((id) => columnMap.get(id))
        .filter((c): c is ColumnDef => Boolean(c)),
    [columnOrder, columnMap],
  );

  const visibleColumns = useMemo(
    () => orderedColumns.filter((c) => visibleIds.has(c.id)),
    [orderedColumns, visibleIds],
  );

  return {
    visibleIds,
    setVisibleIds,
    columnOrder,
    reorderColumns,
    orderedColumns,
    widths,
    colorMode,
    setColorMode,
    startResize,
    visibleColumns,
  };
}
