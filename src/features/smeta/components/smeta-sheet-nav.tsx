"use client";

import { useMemo, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export type NavSheetItem = {
  id: string;
  name: string;
  pinned: boolean;
};

export function SmetaSheetNavigator({
  sheets,
  activeSheetId,
  collapsed,
  canWrite,
  onToggleCollapsed,
  onSelectSheet,
  onTogglePinned,
  freezeRows,
  freezeCols,
  onFreezeRowsChange,
  onFreezeColsChange,
  onApplyFreeze,
  onFreezeToSelection,
  onClearFreeze,
}: {
  sheets: NavSheetItem[];
  activeSheetId: string | null;
  collapsed: boolean;
  canWrite: boolean;
  onToggleCollapsed: () => void;
  onSelectSheet: (sheetId: string) => void;
  onTogglePinned: (sheetId: string, pinned: boolean) => void;
  freezeRows: number;
  freezeCols: number;
  onFreezeRowsChange: (n: number) => void;
  onFreezeColsChange: (n: number) => void;
  onApplyFreeze: (rows?: number, cols?: number) => void;
  onFreezeToSelection: () => void;
  onClearFreeze: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? sheets.filter((s) => s.name.toLowerCase().includes(q))
      : sheets;
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return 0;
    });
  }, [sheets, query]);

  const pinnedCount = sheets.filter((s) => s.pinned).length;

  if (collapsed) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center gap-2 border-r border-[var(--border)] bg-[var(--muted)]/30 py-2">
        <button
          type="button"
          className="rounded-lg p-2 text-[var(--muted-fg)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          title="Показать список листов"
          aria-label="Показать список листов"
          onClick={onToggleCollapsed}
        >
          <ChevronRightIcon />
        </button>
        <span
          className="writing-mode-vertical text-[10px] tracking-wide text-[var(--muted-fg)]"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          Листы · {sheets.length}
        </span>
      </div>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--muted)]/20">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-fg)]">
            Листы
          </p>
          <p className="text-[11px] text-[var(--muted-fg)]">
            {sheets.length}
            {pinnedCount ? ` · ★ ${pinnedCount}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg p-1.5 text-[var(--muted-fg)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          title="Свернуть"
          aria-label="Свернуть список листов"
          onClick={onToggleCollapsed}
        >
          <ChevronLeftIcon />
        </button>
      </div>

      <div className="border-b border-[var(--border)] px-3 py-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по названию…"
          className="h-8 rounded-lg text-sm"
          aria-label="Поиск листов"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {filtered.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-[var(--muted-fg)]">
            Ничего не найдено
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((sheet) => {
              const active = sheet.id === activeSheetId;
              return (
                <li key={sheet.id} className="flex items-stretch gap-0.5">
                  <button
                    type="button"
                    onClick={() => onSelectSheet(sheet.id)}
                    className={cn(
                      "min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                      active
                        ? "bg-[var(--foreground)] text-[var(--background)]"
                        : "text-[var(--foreground)] hover:bg-[var(--muted)]",
                    )}
                    title={sheet.name}
                  >
                    <span className="block truncate">
                      {sheet.pinned ? (
                        <span className="mr-1 opacity-80" aria-hidden>
                          ★
                        </span>
                      ) : null}
                      {sheet.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={!canWrite}
                    onClick={() => onTogglePinned(sheet.id, !sheet.pinned)}
                    className={cn(
                      "shrink-0 rounded-lg px-1.5 text-sm transition-colors",
                      sheet.pinned
                        ? "text-amber-600 hover:bg-amber-500/10"
                        : "text-[var(--muted-fg)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
                      !canWrite && "opacity-40",
                    )}
                    title={
                      sheet.pinned
                        ? "Убрать из избранного"
                        : "В избранное (в начало списка)"
                    }
                    aria-label={
                      sheet.pinned
                        ? `Убрать «${sheet.name}» из избранного`
                        : `Добавить «${sheet.name}» в избранное`
                    }
                    aria-pressed={sheet.pinned}
                  >
                    {sheet.pinned ? "★" : "☆"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-[var(--border)] px-3 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-fg)]">
          Закрепление
        </p>
        <p className="text-[11px] leading-snug text-[var(--muted-fg)]">
          Шапка не уезжает при прокрутке длинной сметы
        </p>
        <div className="flex items-center gap-2">
          <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-[var(--muted-fg)]">
            Строк
            <input
              type="number"
              min={0}
              max={50}
              value={freezeRows}
              disabled={!canWrite}
              onChange={(e) =>
                onFreezeRowsChange(Math.max(0, Number(e.target.value) || 0))
              }
              className="glass-input h-8 rounded-lg px-2 text-sm"
            />
          </label>
          <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-[var(--muted-fg)]">
            Столбцов
            <input
              type="number"
              min={0}
              max={20}
              value={freezeCols}
              disabled={!canWrite}
              onChange={(e) =>
                onFreezeColsChange(Math.max(0, Number(e.target.value) || 0))
              }
              className="glass-input h-8 rounded-lg px-2 text-sm"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={!canWrite}
            onClick={() => onApplyFreeze()}
          >
            Применить
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={!canWrite}
            onClick={onFreezeToSelection}
            title="Закрепить строки выше и столбцы левее активной ячейки"
          >
            По ячейке
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-8 px-2 text-xs"
            disabled={!canWrite}
            onClick={onClearFreeze}
          >
            Снять
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {[
            { label: "1 стр.", rows: 1, cols: 0 },
            { label: "1 стлб.", rows: 0, cols: 1 },
            { label: "1×1", rows: 1, cols: 1 },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={!canWrite}
              className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--muted-fg)] hover:bg-[var(--muted)] disabled:opacity-40"
              onClick={() => {
                onFreezeRowsChange(preset.rows);
                onFreezeColsChange(preset.cols);
                onApplyFreeze(preset.rows, preset.cols);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M10 4L6 8l4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
