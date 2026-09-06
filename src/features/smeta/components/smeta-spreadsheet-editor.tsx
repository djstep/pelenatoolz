"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  importBudgetWorkbookFileAction,
  renameBudgetAction,
  saveBudgetAsTemplateAction,
  saveBudgetWorkbookAction,
  toggleBudgetSheetPinnedAction,
} from "@/features/smeta/actions";
import type {
  BudgetClient,
  BudgetListItem,
} from "@/features/smeta/queries";
import type { ImportWarning } from "@/features/smeta/lib/import-workbook";
import {
  SmetaSheetNavigator,
  type NavSheetItem,
} from "@/features/smeta/components/smeta-sheet-nav";
import { formatDateShort } from "@/shared/i18n/format-date";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

type FWorksheet = {
  getSheetId: () => string;
  getSheetName: () => string;
  activate?: () => void;
  getFrozenRows?: () => number;
  getFrozenColumns?: () => number;
  setFrozenRows?: (n: number) => void;
  setFrozenColumns?: (n: number) => void;
  cancelFreeze?: () => void;
  getActiveRange?: () => {
    getRow?: () => number;
    getColumn?: () => number;
    getRange?: () => { startRow: number; startColumn: number };
  } | null;
};

type FWorkbook = {
  save: () => Record<string, unknown>;
  getId?: () => string;
  getSheets?: () => FWorksheet[];
  getActiveSheet?: () => FWorksheet | null;
  setActiveSheet?: (sheet: FWorksheet | string) => void;
};

type UniverAPI = {
  getActiveWorkbook: () => FWorkbook | null;
  createWorkbook: (data: Record<string, unknown>) => void;
  disposeUnit?: (id: string) => void;
  addEvent: (
    event: unknown,
    cb: (...args: unknown[]) => void,
  ) => { dispose?: () => void };
  Event?: {
    CommandExecuted?: unknown;
    ActiveSheetChanged?: unknown;
    SheetCreated?: unknown;
    SheetDeleted?: unknown;
  };
};

const AUTOSAVE_MS = 2500;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function sheetsFromWorkbook(
  workbook: BudgetClient["workbook"],
  pinnedMap: Map<string, boolean>,
): NavSheetItem[] {
  const order = workbook.sheetOrder ?? [];
  const sheets = workbook.sheets ?? {};
  return order.map((id) => {
    const raw = sheets[id] as { name?: string } | undefined;
    return {
      id,
      name: (typeof raw?.name === "string" && raw.name) || id,
      pinned: pinnedMap.get(id) ?? false,
    };
  });
}

export function SmetaSpreadsheetEditor({
  projectId,
  budget,
  budgets,
  canWrite,
}: {
  projectId: string;
  budget: BudgetClient;
  budgets: BudgetListItem[];
  canWrite: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const params = useParams();
  const locale = String(params.locale ?? "ru");
  const smetaBase = `/${locale}/projects/${projectId}/smeta`;
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<{ dispose: () => void } | null>(null);
  const apiRef = useRef<UniverAPI | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState(budget.updatedAt);
  const [title, setTitle] = useState(budget.name);
  const [importWarnings, setImportWarnings] = useState<ImportWarning[]>([]);
  const [pending, start] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canWriteRef = useRef(canWrite);
  canWriteRef.current = canWrite;
  const budgetIdRef = useRef(budget.id);
  budgetIdRef.current = budget.id;

  const initialPinned = new Map(
    budget.sheetsMeta.map((s) => [s.id, s.pinned] as const),
  );
  const [sheets, setSheets] = useState<NavSheetItem[]>(() =>
    sheetsFromWorkbook(budget.workbook, initialPinned),
  );
  const [activeSheetId, setActiveSheetId] = useState<string | null>(
    budget.workbook.sheetOrder?.[0] ?? null,
  );
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [freezeRows, setFreezeRows] = useState(0);
  const [freezeCols, setFreezeCols] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`smeta-nav-collapsed:${budget.id}`);
      if (raw === "1") setNavCollapsed(true);
    } catch {
      /* ignore */
    }
  }, [budget.id]);

  function toggleNavCollapsed() {
    setNavCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(
          `smeta-nav-collapsed:${budget.id}`,
          next ? "1" : "0",
        );
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function syncSheetsFromApi() {
    const wb = apiRef.current?.getActiveWorkbook?.();
    if (!wb?.getSheets) return;
    const live = wb.getSheets();
    setSheets((prev) => {
      const pinnedMap = new Map(prev.map((s) => [s.id, s.pinned]));
      return live.map((s) => ({
        id: s.getSheetId(),
        name: s.getSheetName() || s.getSheetId(),
        pinned: pinnedMap.get(s.getSheetId()) ?? false,
      }));
    });
    const active = wb.getActiveSheet?.();
    if (active) {
      setActiveSheetId(active.getSheetId());
      syncFreezeFromSheet(active);
    }
  }

  function syncFreezeFromSheet(sheet: FWorksheet) {
    try {
      setFreezeRows(Math.max(0, sheet.getFrozenRows?.() ?? 0));
      setFreezeCols(Math.max(0, sheet.getFrozenColumns?.() ?? 0));
    } catch {
      /* ignore */
    }
  }

  function scheduleSave() {
    if (!canWriteRef.current) return;
    setStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_MS);
  }

  async function flushSave() {
    if (!canWriteRef.current) return;
    const api = apiRef.current;
    const active = api?.getActiveWorkbook?.();
    if (!active) return;
    let snapshot: Record<string, unknown>;
    try {
      snapshot = active.save();
    } catch {
      return;
    }
    setStatus("saving");
    const result = await saveBudgetWorkbookAction(
      projectId,
      budgetIdRef.current,
      { data: snapshot },
    );
    if (result.error) {
      setStatus("error");
      toast.error(result.error);
      return;
    }
    if (result.updatedAt) setSavedAt(result.updatedAt);
    setStatus("saved");
    syncSheetsFromApi();
  }

  useEffect(() => {
    let disposed = false;
    const disposables: Array<{ dispose?: () => void }> = [];

    async function boot() {
      if (!containerRef.current) return;

      const { createUniver, LocaleType, mergeLocales } = await import(
        "@univerjs/presets"
      );
      const { UniverSheetsCorePreset } = await import(
        "@univerjs/preset-sheets-core"
      );
      const UniverPresetSheetsCoreRuRU = (
        await import("@univerjs/preset-sheets-core/locales/ru-RU")
      ).default;

      await import("@univerjs/preset-sheets-core/lib/index.css");

      if (disposed || !containerRef.current) return;

      const { univer, univerAPI } = createUniver({
        locale: LocaleType.RU_RU,
        locales: {
          [LocaleType.RU_RU]: mergeLocales(UniverPresetSheetsCoreRuRU),
        },
        presets: [
          UniverSheetsCorePreset({
            container: containerRef.current,
            header: true,
            toolbar: true,
            formulaBar: true,
            footer: {
              sheetBar: true,
              statisticBar: true,
              menus: true,
              zoomSlider: true,
            },
            contextMenu: true,
          }),
        ],
      });

      univerRef.current = univer;
      const api = univerAPI as unknown as UniverAPI;
      apiRef.current = api;

      univerAPI.createWorkbook(budget.workbook as never);

      queueMicrotask(() => {
        if (!disposed) syncSheetsFromApi();
      });

      const listen = (key: unknown, cb: (...args: unknown[]) => void) => {
        if (key == null) return;
        try {
          disposables.push(api.addEvent(key, cb));
        } catch {
          /* optional */
        }
      };

      listen(api.Event?.CommandExecuted, () => {
        scheduleSave();
        syncSheetsFromApi();
      });
      listen(api.Event?.ActiveSheetChanged, (params) => {
        const p = params as { activeSheet?: FWorksheet };
        if (p.activeSheet) {
          setActiveSheetId(p.activeSheet.getSheetId());
          syncFreezeFromSheet(p.activeSheet);
        } else {
          syncSheetsFromApi();
        }
      });
      listen(api.Event?.SheetCreated, () => syncSheetsFromApi());
      listen(api.Event?.SheetDeleted, () => syncSheetsFromApi());
    }

    void boot();

    return () => {
      disposed = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      for (const d of disposables) {
        try {
          d.dispose?.();
        } catch {
          /* ignore */
        }
      }
      // Univer unmounts its own React root; must not run inside React's render/cleanup.
      const instance = univerRef.current;
      univerRef.current = null;
      apiRef.current = null;
      if (instance) {
        // Defer past React commit — Univer dispose() unmounts a nested React root.
        setTimeout(() => {
          try {
            instance.dispose();
          } catch {
            /* ignore */
          }
        }, 0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount via key={budget.id}
  }, [budget.id]);

  function onSelectSheet(sheetId: string) {
    const wb = apiRef.current?.getActiveWorkbook?.();
    if (!wb) return;
    try {
      const sheet = wb.getSheets?.().find((s) => s.getSheetId() === sheetId);
      if (sheet) {
        if (wb.setActiveSheet) wb.setActiveSheet(sheet);
        else sheet.activate?.();
        setActiveSheetId(sheetId);
        syncFreezeFromSheet(sheet);
      }
    } catch (err) {
      console.error("[smeta activate sheet]", err);
      toast.error("Не удалось открыть лист");
    }
  }

  function onTogglePinned(sheetId: string, pinned: boolean) {
    if (!canWrite) return;
    setSheets((prev) =>
      prev.map((s) => (s.id === sheetId ? { ...s, pinned } : s)),
    );
    start(async () => {
      const result = await toggleBudgetSheetPinnedAction(
        projectId,
        budget.id,
        { sheetId, pinned },
      );
      if (result.error) {
        toast.error(result.error);
        setSheets((prev) =>
          prev.map((s) =>
            s.id === sheetId ? { ...s, pinned: !pinned } : s,
          ),
        );
      }
    });
  }

  function applyFreeze(rows = freezeRows, cols = freezeCols) {
    if (!canWrite) return;
    const sheet = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.();
    if (!sheet) return;
    try {
      const r = Math.max(0, rows);
      const c = Math.max(0, cols);
      setFreezeRows(r);
      setFreezeCols(c);
      if (r === 0 && c === 0) {
        sheet.cancelFreeze?.();
      } else {
        sheet.setFrozenRows?.(r);
        sheet.setFrozenColumns?.(c);
      }
      scheduleSave();
    } catch (err) {
      console.error("[smeta freeze]", err);
      toast.error("Не удалось закрепить области");
    }
  }

  function freezeToSelection() {
    if (!canWrite) return;
    const sheet = apiRef.current?.getActiveWorkbook?.()?.getActiveSheet?.();
    if (!sheet) return;
    try {
      const range = sheet.getActiveRange?.();
      let row = 0;
      let col = 0;
      if (range?.getRow && range?.getColumn) {
        row = range.getRow();
        col = range.getColumn();
      } else if (range?.getRange) {
        const r = range.getRange();
        row = r.startRow;
        col = r.startColumn;
      }
      applyFreeze(Math.max(0, row), Math.max(0, col));
    } catch (err) {
      console.error("[smeta freeze selection]", err);
      toast.error("Выберите ячейку и попробуйте снова");
    }
  }

  function clearFreeze() {
    applyFreeze(0, 0);
  }

  function onSelectBudget(nextId: string) {
    if (nextId === budget.id) return;
    router.push(`${smetaBase}?budgetId=${nextId}`);
  }

  function onRenameBlur() {
    if (!canWrite) return;
    const next = title.trim();
    if (!next || next === budget.name) {
      setTitle(budget.name);
      return;
    }
    start(async () => {
      const result = await renameBudgetAction(projectId, budget.id, {
        name: next,
      });
      if (result.error) {
        toast.error(result.error);
        setTitle(budget.name);
        return;
      }
      if (result.name) setTitle(result.name);
      toast.success(result.success ?? "Сохранено");
      router.refresh();
    });
  }

  function onImportFile(file: File) {
    if (!canWrite) return;
    const defaultName =
      file.name.replace(/\.(xlsx|xls|xlsm|csv)$/i, "").trim() || "Смета";
    start(async () => {
      try {
        const base64 = await fileToBase64(file);
        const result = await importBudgetWorkbookFileAction(projectId, {
          fileName: file.name,
          base64,
          name: defaultName,
        });
        if (!result.success || !result.budgetId) {
          toast.error(result.error ?? "Не удалось импортировать файл");
          return;
        }

        setImportWarnings(result.warnings ?? []);
        toast.success(
          `${result.success}${
            result.sheetCount ? ` · ${result.sheetCount} лист(ов)` : ""
          }`,
        );
        router.push(`${smetaBase}?budgetId=${result.budgetId}`);
        router.refresh();
      } catch (err) {
        console.error("[smeta import]", err);
        toast.error("Не удалось импортировать файл");
      }
    });
  }

  const statusLabel =
    status === "saving" || pending
      ? "Сохранение…"
      : status === "dirty"
        ? "Есть изменения…"
        : status === "error"
          ? "Ошибка сохранения"
          : status === "saved"
            ? `Сохранено ${formatDateShort(savedAt)}`
            : `Обновлено ${formatDateShort(savedAt)}`;

  const projectHref = `/${locale}/projects/${projectId}`;
  const [isFullscreen, setIsFullscreen] = useState(true);

  function setFullscreen(next: boolean) {
    setIsFullscreen(next);
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }

  useEffect(() => {
    if (!isFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setFullscreen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  return (
    <div
      className={cn(
        "flex flex-col text-[var(--foreground)]",
        isFullscreen
          ? "smeta-editor--fullscreen"
          : "smeta-editor--embedded min-h-0",
      )}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel-solid)] px-3 py-2 sm:gap-3 sm:px-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Input
            value={title}
            disabled={!canWrite || pending}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={onRenameBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
            className="font-display h-9 max-w-md min-w-[10rem] flex-1 text-base font-semibold"
            aria-label="Название сметы"
          />
          {budgets.length > 0 ? (
            <Select
              value={budget.id}
              onChange={(e) => onSelectBudget(e.target.value)}
              className="h-9 max-w-[14rem]"
              id="smeta-budget-switcher"
            >
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-xs",
              status === "error"
                ? "text-[var(--danger)]"
                : "text-[var(--foreground)]/70",
            )}
          >
            {statusLabel}
          </span>
          {canWrite ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onImportFile(f);
                }}
              />
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={pending}
                onClick={() =>
                  router.push(`${smetaBase}?create=1`)
                }
              >
                Новая смета
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                onClick={() => router.push(`${smetaBase}/templates`)}
              >
                Шаблоны
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={pending}
                onClick={() => {
                  const name = window.prompt(
                    "Название шаблона",
                    `${budget.name} (шаблон)`,
                  );
                  if (!name?.trim()) return;
                  start(async () => {
                    const result = await saveBudgetAsTemplateAction(
                      projectId,
                      budget.id,
                      { name: name.trim() },
                    );
                    if (result.error) {
                      toast.error(result.error);
                      return;
                    }
                    toast.success(result.success ?? "Шаблон сохранён");
                  });
                }}
              >
                В шаблон
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={pending}
                onClick={() => fileInputRef.current?.click()}
              >
                Импорт Excel/CSV
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={pending || status === "saving"}
                onClick={() => void flushSave()}
              >
                Сохранить
              </Button>
            </>
          ) : (
            <span className="text-xs text-[var(--foreground)]/70">
              Только просмотр
            </span>
          )}
          {!isFullscreen ? (
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              onClick={() => setFullscreen(true)}
            >
              На весь экран
            </Button>
          ) : null}
        </div>
      </header>

      {importWarnings.length > 0 ? (
        <div
          className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm"
          role="status"
        >
          <p className="font-medium text-amber-100">
            Импорт выполнен с ограничениями — что не перенесено полностью:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[var(--foreground)]">
            {importWarnings.map((w) => (
              <li key={w.code + w.message}>{w.message}</li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-1 text-xs text-[var(--foreground)]/70 underline hover:text-[var(--foreground)]"
            onClick={() => setImportWarnings([])}
          >
            Скрыть
          </button>
        </div>
      ) : null}

      <div
        className="flex min-h-0 flex-1 overflow-hidden"
        style={
          isFullscreen ? undefined : { minHeight: "calc(100vh - 12rem)" }
        }
      >
        <SmetaSheetNavigator
          sheets={sheets}
          activeSheetId={activeSheetId}
          collapsed={navCollapsed}
          canWrite={canWrite}
          onToggleCollapsed={toggleNavCollapsed}
          onSelectSheet={onSelectSheet}
          onTogglePinned={onTogglePinned}
          freezeRows={freezeRows}
          freezeCols={freezeCols}
          onFreezeRowsChange={setFreezeRows}
          onFreezeColsChange={setFreezeCols}
          onApplyFreeze={applyFreeze}
          onFreezeToSelection={freezeToSelection}
          onClearFreeze={clearFreeze}
          isFullscreen={isFullscreen}
          onExitFullscreen={() => setFullscreen(false)}
          projectHref={projectHref}
        />
        <div
          ref={containerRef}
          className="univer-smeta-host min-h-0 min-w-0 flex-1 bg-white"
        />
      </div>
    </div>
  );
}
