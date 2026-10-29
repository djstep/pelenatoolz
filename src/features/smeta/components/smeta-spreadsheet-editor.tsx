"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  saveDepartmentBudgetAction,
  toggleBudgetSheetPinnedAction,
} from "@/features/smeta/actions";
import type { BudgetClient } from "@/features/smeta/queries";
import {
  HEADER_ROW,
  MAIN_HEADERS,
  NO_AUTO_CODE_KEY,
  findMainColumns,
  nextCode,
  normalizeCode,
  rowFormulas,
  type MainColumns,
  type SmetaCheck,
} from "@/features/smeta/lib/main-sheet";
import {
  SmetaSheetNavigator,
  type NavSheetItem,
} from "@/features/smeta/components/smeta-sheet-nav";
import { SmetaChecksPanel } from "@/features/smeta/components/smeta-checks-panel";
import { formatDateShort } from "@/shared/i18n/format-date";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

type IRange = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

type FRange = {
  getSheetId?: () => string;
  getRange: () => IRange;
  getValue: () => unknown;
  getValues: () => unknown[][];
  getFormula: () => string;
  setValue: (value: unknown) => FRange;
  setFormula: (formula: string) => FRange;
  activate?: () => FRange;
  highlight?: (style?: Record<string, unknown>) => { dispose: () => void };
  getRangePermission?: () => {
    protect: (options?: { name?: string }) => Promise<{
      setPoint: (point: string, value: boolean) => Promise<void>;
    }>;
  };
};

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
  getRange: (row: number, column: number, numRows?: number, numColumns?: number) => FRange;
  getMaxColumns: () => number;
  getLastRow: () => number;
  getRowCustomMetadata?: (index: number) => Record<string, unknown> | undefined;
  setRowCustomMetadata?: (index: number, custom: Record<string, unknown> | undefined) => void;
  getSheet?: () => { getRowManager: () => { getRowOrCreate: (index: number) => unknown } };
  scrollToCell?: (row: number, column: number) => void;
};

type FWorkbook = {
  save: () => Record<string, unknown>;
  getId?: () => string;
  getSheets?: () => FWorksheet[];
  getSheetBySheetId?: (id: string) => FWorksheet | null;
  getActiveSheet?: () => FWorksheet | null;
  setActiveSheet?: (sheet: FWorksheet | string) => void;
  setEditable?: (value: boolean) => void;
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
    BeforeSheetDelete?: unknown;
    SheetValueChanged?: unknown;
  };
  Enum?: { RangePermissionPoint?: Record<string, string> };
};

const AUTOSAVE_MS = 2500;

const HIGHLIGHT_STYLE = {
  strokeWidth: 1,
  stroke: "#d97706",
  fill: "rgba(245, 158, 11, 0.14)",
};

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

function isEmpty(value: unknown) {
  return value == null || String(value).trim() === "";
}

/** Колонки основного листа по живой строке заголовков. */
function liveColumns(sheet: FWorksheet) {
  const width = Math.max(1, sheet.getMaxColumns());
  const values = sheet.getRange(HEADER_ROW, 0, 1, width).getValues()[0] ?? [];
  const header: Record<number, { v: unknown }> = {};
  values.forEach((v, i) => {
    if (!isEmpty(v)) header[i] = { v };
  });
  return { ...findMainColumns({ cellData: { [HEADER_ROW]: header } }), width: values.length };
}

export function SmetaSpreadsheetEditor({
  projectId,
  department,
  budget,
  canWrite,
  initialChecks,
  usedCodes,
  listHref,
}: {
  projectId: string;
  department: { id: string; name: string; codePrefix: string };
  budget: BudgetClient;
  canWrite: boolean;
  initialChecks: SmetaCheck[];
  usedCodes: string[];
  listHref: string;
}) {
  const toast = useToast();
  const params = useParams();
  const locale = String(params.locale ?? "ru");
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<{ dispose: () => void } | null>(null);
  const apiRef = useRef<UniverAPI | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState(budget.updatedAt);
  const [checks, setChecks] = useState<SmetaCheck[]>(initialChecks);
  const [missingHeaders, setMissingHeaders] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const canWriteRef = useRef(canWrite);
  canWriteRef.current = canWrite;
  const usedCodesRef = useRef(new Set(usedCodes.map(normalizeCode)));
  const checksRef = useRef(checks);
  checksRef.current = checks;
  const highlightsRef = useRef<{ dispose: () => void }[]>([]);
  /** Пока редактор сам пишет в ячейки или ставит защиту — это не правка главы. */
  const applyingRef = useRef(false);
  const mainKey = budget.mainSheetKey;

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

  function mainSheet(): FWorksheet | null {
    if (!mainKey) return null;
    return apiRef.current?.getActiveWorkbook?.()?.getSheetBySheetId?.(mainKey) ?? null;
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

  /** Подсветка строк с проверками на основном листе. В книгу не пишется. */
  function applyHighlights(list: SmetaCheck[] = checksRef.current) {
    for (const h of highlightsRef.current) {
      try {
        h.dispose();
      } catch {
        /* ignore */
      }
    }
    highlightsRef.current = [];
    const sheet = mainSheet();
    const wb = apiRef.current?.getActiveWorkbook?.();
    if (!sheet || wb?.getActiveSheet?.()?.getSheetId() !== mainKey) return;
    const width = Math.max(MAIN_HEADERS.length, liveColumns(sheet).width);
    const rows = new Set(list.filter((c) => c.kind !== "headers").map((c) => c.row));
    for (const row of rows) {
      try {
        const handle = sheet.getRange(row, 0, 1, width).highlight?.(HIGHLIGHT_STYLE);
        if (handle) highlightsRef.current.push(handle);
      } catch {
        /* ignore */
      }
    }
  }

  function refreshMissingHeaders() {
    const sheet = mainSheet();
    if (!sheet) return;
    try {
      setMissingHeaders(liveColumns(sheet).missing);
    } catch {
      /* ignore */
    }
  }

  function scheduleSave() {
    if (!canWriteRef.current || applyingRef.current) return;
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
    const result = await saveDepartmentBudgetAction(projectId, department.id, {
      data: snapshot,
    });
    if (result.error !== undefined) {
      setStatus("error");
      toast.error(result.error);
      return;
    }
    setSavedAt(result.updatedAt);
    setChecks(result.checks);
    usedCodesRef.current = new Set(result.usedCodes.map(normalizeCode));
    setStatus("saved");
    syncSheetsFromApi();
    refreshMissingHeaders();
    applyHighlights(result.checks);
  }

  /**
   * Автокод: в строке основного листа появилась Ставка (значение или формула), кода нет
   * и глава его не стирал. Тогда ставим следующий код и формулы Сумма, Налог, Итого
   * (только в пустые ячейки). Стёр код сам — строка помечается, автокод больше не ставится.
   */
  function onMainValuesChanged(ranges: FRange[]) {
    if (!canWriteRef.current || applyingRef.current || !mainKey) return;
    const sheet = mainSheet();
    if (!sheet) return;
    const found = liveColumns(sheet);
    if (found.missing.length > 0) return;
    const cols = found.columns as MainColumns;

    const touched = new Map<number, { code: boolean; rate: boolean }>();
    for (const range of ranges) {
      if (range.getSheetId?.() !== mainKey) continue;
      const r = range.getRange();
      const hits = (c: number) => r.startColumn <= c && c <= r.endColumn;
      for (let row = Math.max(r.startRow, HEADER_ROW + 1); row <= r.endRow; row++) {
        const prev = touched.get(row) ?? { code: false, rate: false };
        touched.set(row, {
          code: prev.code || hits(cols.code),
          rate: prev.rate || hits(cols.rate) || hits(cols.quantity),
        });
      }
    }
    if (touched.size === 0) return;

    applyingRef.current = true;
    try {
      const lastRow = Math.max(sheet.getLastRow(), HEADER_ROW + 1);
      const codeColumn = sheet
        .getRange(HEADER_ROW + 1, cols.code, lastRow - HEADER_ROW, 1)
        .getValues()
        .map((r) => (isEmpty(r[0]) ? "" : String(r[0]).trim()));
      const known = new Set([...usedCodesRef.current, ...codeColumn.filter(Boolean).map(normalizeCode)]);

      for (const row of [...touched.keys()].sort((a, b) => a - b)) {
        const { code: touchedCode, rate: touchedRate } = touched.get(row)!;
        const codeEmpty = isEmpty(sheet.getRange(row, cols.code).getValue());
        if (!codeEmpty) continue;
        const meta = sheet.getRowCustomMetadata?.(row) ?? {};

        if (touchedCode && !touchedRate) {
          // Глава стёр код в этой строке — не ставить его снова.
          if (!meta[NO_AUTO_CODE_KEY]) {
            // Univer пишет метку только в существующую запись строки — создать её.
            sheet.getSheet?.().getRowManager().getRowOrCreate(row);
            sheet.setRowCustomMetadata?.(row, { ...meta, [NO_AUTO_CODE_KEY]: true });
          }
          continue;
        }
        if (!touchedRate || meta[NO_AUTO_CODE_KEY]) continue;

        const rateCell = sheet.getRange(row, cols.rate);
        if (isEmpty(rateCell.getValue()) && isEmpty(rateCell.getFormula())) continue;

        const above = codeColumn.slice(0, row - HEADER_ROW - 1).filter(Boolean);
        const code = nextCode(department.codePrefix, above, known);
        known.add(code);
        codeColumn[row - HEADER_ROW - 1] = code;
        sheet.getRange(row, cols.code).setValue(code);

        const formulas = rowFormulas(cols, row);
        for (const [key, formula] of [
          ["amount", formulas.amount],
          ["tax", formulas.tax],
          ["total", formulas.total],
        ] as const) {
          const cell = sheet.getRange(row, cols[key]);
          if (isEmpty(cell.getValue()) && isEmpty(cell.getFormula())) cell.setFormula(formula);
        }
      }
    } catch (err) {
      console.error("[smeta autocode]", err);
    } finally {
      applyingRef.current = false;
    }
    scheduleSave();
  }

  /** Дописать недостающие заголовки в первые свободные колонки справа. */
  function restoreHeaders() {
    const sheet = mainSheet();
    if (!sheet || !canWriteRef.current) return;
    try {
      const found = liveColumns(sheet);
      const values = sheet.getRange(HEADER_ROW, 0, 1, found.width).getValues()[0] ?? [];
      let col = values.length;
      while (col > 0 && isEmpty(values[col - 1])) col--;
      for (const title of found.missing) {
        sheet.getRange(HEADER_ROW, col++).setValue(title);
      }
      toast.success("Заголовки восстановлены");
      refreshMissingHeaders();
      scheduleSave();
    } catch (err) {
      console.error("[smeta restore headers]", err);
      toast.error("Не удалось восстановить заголовки");
    }
  }

  function goToRow(row: number) {
    const wb = apiRef.current?.getActiveWorkbook?.();
    const sheet = mainSheet();
    if (!wb || !sheet) return;
    try {
      wb.setActiveSheet?.(sheet);
      setActiveSheetId(mainKey);
      sheet.getRange(row, 0).activate?.();
      sheet.scrollToCell?.(Math.max(0, row - 3), 0);
      requestAnimationFrame(() => applyHighlights());
    } catch (err) {
      console.error("[smeta go to row]", err);
    }
  }

  useEffect(() => {
    let disposed = false;
    const disposables: Array<{ dispose?: () => void }> = [];

    async function boot() {
      if (!containerRef.current) return;

      try {
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

        // Дождаться реальных пикселей контейнера (absolute inset)
        const host = containerRef.current;
        for (let i = 0; i < 20; i++) {
          if (disposed) return;
          if (host.clientWidth > 40 && host.clientHeight > 40) break;
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
        if (disposed || !containerRef.current) return;

        const { defaultTheme } = await import("@univerjs/themes");

        const { univer, univerAPI } = createUniver({
          theme: defaultTheme,
          locale: LocaleType.RU_RU,
          darkMode: false,
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

        if (disposed) {
          try {
            univer.dispose();
          } catch {
            /* ignore */
          }
          return;
        }

        try {
          (
            univerAPI as unknown as { setDarkMode?: (v: boolean) => void }
          ).setDarkMode?.(false);
        } catch {
          /* optional */
        }

        univerRef.current = univer;
        const api = univerAPI as unknown as UniverAPI;
        apiRef.current = api;

        univerAPI.createWorkbook(budget.workbook as never);

        if (disposed) {
          try {
            univer.dispose();
          } catch {
            /* ignore */
          }
          univerRef.current = null;
          apiRef.current = null;
          return;
        }

        const workbook = api.getActiveWorkbook();
        if (!canWriteRef.current) {
          // Продюсер и «просмотр всех» — только чтение (сервер их правки тоже не примет).
          workbook?.setEditable?.(false);
        } else {
          // Заголовки основного листа: не переименовать, не удалить, не сдвинуть.
          const sheet = mainSheet();
          const found = sheet ? liveColumns(sheet) : null;
          const present = found
            ? Object.values(found.columns).filter((c): c is number => typeof c === "number")
            : [];
          if (sheet && present.length > 0) {
            applyingRef.current = true;
            try {
              const from = Math.min(...present);
              const to = Math.max(...present);
              const rule = await sheet
                .getRange(HEADER_ROW, from, 1, to - from + 1)
                .getRangePermission?.()
                .protect({ name: "Заголовки сметы" });
              const point = api.Enum?.RangePermissionPoint;
              if (rule && point) {
                await rule.setPoint(point.Edit ?? "RangeEdit", false);
                await rule.setPoint(point.Delete ?? "RangeDeleteProtection", false);
                await rule.setPoint(point.ManageCollaborator ?? "RangeManageCollaborator", false);
              }
            } catch (err) {
              console.error("[smeta protect headers]", err);
            } finally {
              applyingRef.current = false;
            }
          }
        }

        const kickResize = () => {
          window.dispatchEvent(new Event("resize"));
        };
        requestAnimationFrame(() => {
          kickResize();
          setTimeout(kickResize, 80);
          setTimeout(kickResize, 300);
        });

        const hostEl = containerRef.current;
        let resizeObserver: ResizeObserver | null = null;
        if (hostEl && typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => kickResize());
          resizeObserver.observe(hostEl);
          disposables.push({
            dispose: () => resizeObserver?.disconnect(),
          });
        }

        queueMicrotask(() => {
          if (disposed) return;
          syncSheetsFromApi();
          refreshMissingHeaders();
          applyHighlights();
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
        listen(api.Event?.SheetValueChanged, (params) => {
          const p = params as { effectedRanges?: FRange[] };
          onMainValuesChanged(p.effectedRanges ?? []);
        });
        listen(api.Event?.BeforeSheetDelete, (params) => {
          const p = params as { worksheet?: FWorksheet; cancel?: boolean };
          if (p.worksheet?.getSheetId() === mainKey) {
            p.cancel = true;
            toast.error("Основной лист удалить нельзя");
          }
        });
        listen(api.Event?.ActiveSheetChanged, (params) => {
          const p = params as { activeSheet?: FWorksheet };
          if (p.activeSheet) {
            setActiveSheetId(p.activeSheet.getSheetId());
            syncFreezeFromSheet(p.activeSheet);
          } else {
            syncSheetsFromApi();
          }
          requestAnimationFrame(() => applyHighlights());
        });
        listen(api.Event?.SheetCreated, () => syncSheetsFromApi());
        listen(api.Event?.SheetDeleted, () => syncSheetsFromApi());
      } catch (err) {
        console.error("[smeta univer boot]", err);
        toast.error("Не удалось загрузить табличный редактор");
      }
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
      highlightsRef.current = [];
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
        department.id,
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
  const [isFullscreen, setIsFullscreen] = useState(false);

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
        "flex min-h-0 flex-1 flex-col text-[var(--foreground)]",
        isFullscreen
          ? "smeta-editor--fullscreen"
          : "smeta-editor--embedded",
      )}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--panel-solid)] px-3 py-2 sm:gap-3 sm:px-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <Link
            href={listHref}
            className="text-sm text-[var(--muted-fg)] hover:underline"
          >
            ← Все сметы
          </Link>
          <h2 className="font-display truncate text-base font-semibold">
            Смета — {department.name}
          </h2>
          <span className="font-mono text-xs text-[var(--muted-fg)]">
            {department.codePrefix}
          </span>
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
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              disabled={pending || status === "saving"}
              onClick={() => void flushSave()}
            >
              Сохранить
            </Button>
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

      <SmetaChecksPanel
        checks={checks}
        canRestoreHeaders={canWrite && missingHeaders.length > 0}
        onSelectRow={goToRow}
        onRestoreHeaders={restoreHeaders}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 flex min-h-0 overflow-hidden">
          <SmetaSheetNavigator
            sheets={sheets}
            activeSheetId={activeSheetId}
            mainSheetId={mainKey}
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
          <div className="relative min-h-0 min-w-0 flex-1">
            <div
              ref={containerRef}
              className="univer-smeta-host"
              style={{ background: "#ffffff" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
