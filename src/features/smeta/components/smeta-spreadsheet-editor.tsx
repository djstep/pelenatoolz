"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  importBudgetExcelAction,
  saveDepartmentBudgetAction,
  toggleBudgetSheetPinnedAction,
} from "@/features/smeta/actions";
import { SAVE_BODY_LIMIT_BYTES, stableJson } from "@/features/smeta/lib/stable-json";
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
import {
  SmetaApprovalBanner,
  SmetaApprovalControls,
} from "@/features/smeta/components/smeta-approval-controls";
import type { BudgetApprovalInfo } from "@/features/smeta/approval-queries";

export type SmetaApprovalProps = {
  info: BudgetApprovalInfo;
  canApprove: boolean;
  reviewHref: string;
  versionsHref: string;
};
import { formatDateShort } from "@/shared/i18n/format-date";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";
import { useUnsavedChanges } from "@/shared/ui/unsaved/unsaved-changes-provider";

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

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
  getWorkbookPermission?: () => { setReadOnly: () => Promise<void> };
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
  };
  Enum?: { RangePermissionPoint?: Record<string, string> };
};

/** Событие Univer CommandExecuted: команда, операция или мутация. */
type CommandEvent = {
  id?: string;
  params?: unknown;
  options?: { onlyLocal?: boolean; fromCollab?: boolean };
};

const AUTOSAVE_MS = 2500;

const SET_RANGE_VALUES = "sheet.mutation.set-range-values";

/**
 * Мутации Univer, которые меняют сохраняемые данные книги, — только они ставят
 * автосохранение. Выделение, прокрутка, масштаб, смена листа — операции, не мутации,
 * и сюда не попадают. Пересчёт формул и служебные записи Univer помечает `onlyLocal` —
 * они пропускаются. Отмена и повтор проигрывают эти же мутации.
 */
const SAVE_MUTATIONS = new Set([
  // значения, формулы, стили ячеек, формат чисел, сортировка
  SET_RANGE_VALUES,
  "sheet.mutation.move-range",
  "sheet.mutation.reorder-range",
  "sheet.mutation.set.numfmt",
  "sheet.mutation.remove.numfmt",
  // строки и колонки
  "sheet.mutation.insert-row",
  "sheet.mutation.insert-col",
  "sheet.mutation.remove-rows",
  "sheet.mutation.remove-col",
  "sheet.mutation.move-rows",
  "sheet.mutation.move-columns",
  "sheet.mutation.set-row-hidden",
  "sheet.mutation.set-row-visible",
  "sheet.mutation.set-col-hidden",
  "sheet.mutation.set-col-visible",
  "sheet.mutation.set-worksheet-row-count",
  "sheet.mutation.set-worksheet-column-count",
  // объединения
  "sheet.mutation.add-worksheet-merge",
  "sheet.mutation.remove-worksheet-merge",
  // ширина и высота
  "sheet.mutation.set-worksheet-col-width",
  "sheet.mutation.set-worksheet-row-height",
  "sheet.mutation.set-worksheet-row-is-auto-height",
  // стили строк, колонок и листа, метки строк (smetaNoAutoCode)
  "sheet.mutation.set-row-data",
  "sheet.mutation.set-col-data",
  "sheet.mutation.set-worksheet-default-style",
  // листы
  "sheet.mutation.insert-sheet",
  "sheet.mutation.remove-sheet",
  "sheet.mutation.set-worksheet-name",
  "sheet.mutation.set-worksheet-order",
  "sheet.mutation.set-tab-color",
  "sheet.mutation.set-worksheet-hidden",
  // закрепление и сетка
  "sheet.mutation.set-frozen",
  "sheet.mutation.toggle-gridlines",
  "sheet.mutation.set-gridlines-color",
]);

/** Мутации, после которых меняется список листов в навигаторе. */
const SHEET_LIST_MUTATIONS = new Set([
  "sheet.mutation.insert-sheet",
  "sheet.mutation.remove-sheet",
  "sheet.mutation.set-worksheet-name",
  "sheet.mutation.set-worksheet-order",
  "sheet.mutation.set-worksheet-hidden",
]);

/** Предупреждения импорта — показать после перезагрузки страницы. */
const IMPORT_NOTICE_KEY = "smeta-import-notice";

type WorkbookParts = {
  workbookId: string;
  order: { key: string; name: string }[];
  orderJson: string;
  sheets: Map<string, { data: Record<string, unknown>; json: string }>;
  styles: Record<string, unknown>;
  stylesJson: string;
};

/** Книга Univer по частям: листы со строкой для сравнения, порядок и имена, стили. */
function workbookParts(snapshot: Record<string, unknown>): WorkbookParts {
  const raw = (snapshot.sheets ?? {}) as Record<string, Record<string, unknown>>;
  const keys = Array.isArray(snapshot.sheetOrder)
    ? (snapshot.sheetOrder as string[])
    : Object.keys(raw);
  const sheets = new Map<string, { data: Record<string, unknown>; json: string }>();
  const order = keys.map((key) => {
    const data = raw[key] ?? {};
    sheets.set(key, { data, json: stableJson(data) });
    return { key, name: typeof data.name === "string" ? data.name : "" };
  });
  const styles = (snapshot.styles ?? {}) as Record<string, unknown>;
  return {
    workbookId: String(snapshot.id ?? ""),
    order,
    orderJson: JSON.stringify(order),
    sheets,
    styles,
    stylesJson: stableJson(styles),
  };
}

/** Что последний раз ушло на сервер (или было при открытии). */
type Baseline = { sheets: Map<string, string>; orderJson: string; stylesJson: string };

function baselineOf(parts: WorkbookParts): Baseline {
  return {
    sheets: new Map([...parts.sheets].map(([key, s]) => [key, s.json])),
    orderJson: parts.orderJson,
    stylesJson: parts.stylesJson,
  };
}

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
  canWrite: canWriteProp,
  initialChecks,
  usedCodes,
  listHref,
  approval,
  mode = "draft",
  title,
}: {
  projectId: string;
  department: { id: string; name: string; codePrefix: string };
  budget: BudgetClient;
  canWrite: boolean;
  initialChecks: SmetaCheck[];
  usedCodes: string[];
  listHref: string;
  /** Статус утверждения черновика и ссылки на сравнение и версии. */
  approval?: SmetaApprovalProps;
  /** «version» — просмотр утверждённой версии: только чтение, без сохранения и проверок. */
  mode?: "draft" | "version" | "summary";
  title?: string;
}) {
  const canWrite = mode === "draft" ? canWriteProp : false;
  const [approvalInfo, setApprovalInfo] = useState(approval?.info);
  const [approvalProp, setApprovalProp] = useState(approval?.info);
  if (approval?.info !== approvalProp) {
    // Страницу обновили с сервера (после отправки) — берём свежий статус.
    setApprovalProp(approval?.info);
    setApprovalInfo(approval?.info);
  }
  const toast = useToast();
  const params = useParams();
  const locale = String(params.locale ?? "ru");
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<{ dispose: () => void } | null>(null);
  const apiRef = useRef<UniverAPI | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Есть правки, которые ещё не ушли на сервер (в т.ч. после ошибки сохранения). */
  const dirtyRef = useRef(false);
  /** Идущее сохранение: пока оно идёт, новые правки сливаются в одно следующее. */
  const inFlightRef = useRef<Promise<number | null> | null>(null);
  const againRef = useRef(false);
  /** Ревизия, от которой правит эта вкладка. */
  const revisionRef = useRef(budget.revision);
  const baselineRef = useRef<Baseline | null>(null);
  const conflictRef = useRef(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<{ sheets: string[]; warnings: string[] } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const unsaved = useUnsavedChanges();
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

  /** Правка данных книги: сохранить через паузу после последней правки. */
  function markDirty() {
    if (!canWriteRef.current || conflictRef.current) return;
    dirtyRef.current = true;
    // После ошибки плашка «Не сохранено» остаётся до удачного сохранения.
    if (!inFlightRef.current) setStatus((prev) => (prev === "error" ? prev : "dirty"));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_MS);
  }

  /** Книга сейчас как она есть в Univer. */
  function currentParts(): WorkbookParts | null {
    const active = apiRef.current?.getActiveWorkbook?.();
    if (!active) return null;
    try {
      return workbookParts(active.save());
    } catch {
      return null;
    }
  }

  /** Смету сохранили из другого окна: дальше не сохраняем, лист — только просмотр. */
  function enterConflict() {
    conflictRef.current = true;
    dirtyRef.current = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus("conflict");
    void apiRef.current
      ?.getActiveWorkbook?.()
      ?.getWorkbookPermission?.()
      .setReadOnly()
      .catch(() => undefined);
  }

  /**
   * Одно сохранение: на сервер уходят только листы, которые отличаются от последнего
   * отправленного, порядок и имена всех листов и стили — если изменились. Ничего не
   * изменилось — запроса нет. Возвращает ревизию или null, если не сохранилось.
   */
  async function saveOnce(): Promise<number | null> {
    const parts = currentParts();
    if (!parts) return null;
    const base = baselineRef.current;
    const sheets: Record<string, Record<string, unknown>> = {};
    for (const [key, sheet] of parts.sheets) {
      if (base?.sheets.get(key) !== sheet.json) sheets[key] = sheet.data;
    }
    const stylesChanged = base?.stylesJson !== parts.stylesJson;
    dirtyRef.current = false;
    if (Object.keys(sheets).length === 0 && base?.orderJson === parts.orderJson && !stylesChanged) {
      setStatus((prev) => (prev === "idle" ? "idle" : "saved"));
      setSaveError(null);
      return revisionRef.current;
    }

    const payload = {
      workbookId: parts.workbookId,
      baseRevision: revisionRef.current,
      order: parts.order,
      sheets,
      ...(stylesChanged ? { styles: parts.styles } : {}),
    };
    if (new Blob([JSON.stringify(payload)]).size > SAVE_BODY_LIMIT_BYTES) {
      dirtyRef.current = true;
      setStatus("error");
      setSaveError(
        "изменённые листы больше 4 МБ — так много за одно сохранение не уходит. Разделите большой лист на несколько.",
      );
      return null;
    }

    setStatus((prev) => (prev === "error" ? prev : "saving"));
    let result: Awaited<ReturnType<typeof saveDepartmentBudgetAction>>;
    try {
      result = await saveDepartmentBudgetAction(projectId, department.id, payload);
    } catch {
      dirtyRef.current = true;
      setStatus("error");
      setSaveError("нет связи с сервером.");
      return null;
    }
    if (result.error !== undefined) {
      if (result.conflict) {
        enterConflict();
        return null;
      }
      dirtyRef.current = true;
      setStatus("error");
      setSaveError(result.error);
      return null;
    }

    baselineRef.current = baselineOf(parts);
    revisionRef.current = result.revision;
    // Правка во время утверждения или после него — смета снова черновик (решает сервер).
    setApprovalInfo((prev) =>
      prev && prev.status !== result.status
        ? {
            ...prev,
            status: result.status,
            changedAfterSubmitAt:
              prev.status === "SUBMITTED" ? new Date().toISOString() : prev.changedAfterSubmitAt,
          }
        : prev,
    );
    setSavedAt(result.updatedAt);
    setSaveError(null);
    if (result.checks) {
      setChecks(result.checks);
      applyHighlights(result.checks);
    }
    if (result.usedCodes) usedCodesRef.current = new Set(result.usedCodes.map(normalizeCode));
    setStatus(dirtyRef.current ? "dirty" : "saved");
    syncSheetsFromApi();
    refreshMissingHeaders();
    return result.revision;
  }

  /**
   * Сохранить сейчас. Сохранения не копятся в очередь: если одно уже идёт, следующее
   * пройдёт сразу после него одно на все правки, а вызвавший получит его итог.
   * Возвращает ревизию после сохранения или null, если не сохранилось.
   */
  function flushSave(): Promise<number | null> {
    if (!canWriteRef.current || conflictRef.current) return Promise.resolve(null);
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (inFlightRef.current) {
      againRef.current = true;
      return inFlightRef.current;
    }
    const run = (async () => {
      let revision: number | null = null;
      try {
        do {
          againRef.current = false;
          revision = await saveOnce();
        } while (revision !== null && againRef.current);
      } finally {
        inFlightRef.current = null;
      }
      return revision;
    })();
    inFlightRef.current = run;
    return run;
  }

  const flushSaveRef = useRef(flushSave);
  flushSaveRef.current = flushSave;

  // Несохранённые правки и идущее сохранение — в общем механизме: предупреждение браузера
  // при закрытии вкладки и вопрос при переходе по ссылке. Только черновик у главы цеха.
  useEffect(() => {
    if (mode !== "draft" || !canWrite) return;
    return unsaved.register(
      () => !conflictRef.current && (dirtyRef.current || inFlightRef.current !== null),
      async () => (await flushSaveRef.current()) !== null && !dirtyRef.current,
    );
  }, [mode, canWrite, unsaved]);

  /** Импорт .xlsx: досохранить правки, отправить файл, перезагрузить книгу с новыми листами. */
  async function importExcel(file: File) {
    if (/\.xls$/i.test(file.name)) {
      toast.error("Старый формат .xls не поддерживается — сохраните файл как .xlsx");
      return;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      toast.error("Нужен файл Excel в формате .xlsx");
      return;
    }
    if (file.size > 3.5 * 1024 * 1024) {
      toast.error("Файл больше 3,5 МБ — такой не импортируется");
      return;
    }
    setImporting(true);
    try {
      const revision = await flushSave();
      if (revision === null || dirtyRef.current) {
        toast.error("Сначала должны сохраниться правки — импорт не начат");
        return;
      }
      const form = new FormData();
      form.set("file", file);
      form.set("baseRevision", String(revision));
      const result = await importBudgetExcelAction(projectId, department.id, form);
      if (result.error !== undefined) {
        if (result.conflict) enterConflict();
        else toast.error(result.error);
        return;
      }
      try {
        sessionStorage.setItem(
          IMPORT_NOTICE_KEY,
          JSON.stringify({ budgetId: budget.id, sheets: result.sheets, warnings: result.warnings }),
        );
      } catch {
        /* без предупреждений после перезагрузки */
      }
      // Книга в браузере устарела (новые листы, новая ревизия) — загрузить заново.
      window.location.reload();
    } catch {
      toast.error("Не удалось отправить файл — проверьте связь и повторите");
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(IMPORT_NOTICE_KEY);
      if (!raw) return;
      sessionStorage.removeItem(IMPORT_NOTICE_KEY);
      const notice = JSON.parse(raw) as { budgetId?: string; sheets?: string[]; warnings?: string[] };
      if (notice.budgetId !== budget.id) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage есть только в браузере
      setImportNotice({ sheets: notice.sheets ?? [], warnings: notice.warnings ?? [] });
    } catch {
      /* ignore */
    }
  }, [budget.id]);

  /**
   * Автокод: в строке основного листа появилась Ставка (значение или формула), кода нет
   * и глава его не стирал. Тогда ставим следующий код и формулы Сумма, Налог, Итого
   * (только в пустые ячейки). Стёр код сам — строка помечается, автокод больше не ставится.
   * Строки и колонки — из самой мутации записи значений (ячейки `cellValue`).
   */
  function onMainValuesChanged(params: unknown) {
    if (!canWriteRef.current || applyingRef.current || !mainKey) return;
    const p = params as {
      subUnitId?: string;
      cellValue?: Record<string, Record<string, unknown> | null | undefined>;
    } | null;
    if (p?.subUnitId !== mainKey || !p.cellValue) return;
    const sheet = mainSheet();
    if (!sheet) return;
    const found = liveColumns(sheet);
    if (found.missing.length > 0) return;
    const cols = found.columns as MainColumns;

    const touched = new Map<number, { code: boolean; rate: boolean }>();
    for (const [rowKey, rowCells] of Object.entries(p.cellValue)) {
      const row = Number(rowKey);
      if (!Number.isInteger(row) || row <= HEADER_ROW || !rowCells) continue;
      const columns = new Set(Object.keys(rowCells).map(Number));
      touched.set(row, {
        code: columns.has(cols.code),
        rate: columns.has(cols.rate) || columns.has(cols.quantity),
      });
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
      markDirty();
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
          // setEditable(false) Univer перезаписывает при загрузке — нужен режим «просмотр».
          try {
            await workbook?.getWorkbookPermission?.().setReadOnly();
          } catch (err) {
            console.error("[smeta read-only]", err);
          }
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

        // Книга при открытии — точка отсчёта: сохраняется только то, что от неё отличается.
        if (canWriteRef.current) {
          const parts = currentParts();
          if (parts) baselineRef.current = baselineOf(parts);
        }

        listen(api.Event?.CommandExecuted, (event) => {
          const e = event as CommandEvent;
          if (!e.id || !SAVE_MUTATIONS.has(e.id)) return;
          if (e.options?.onlyLocal || e.options?.fromCollab) return;
          if (e.id === SET_RANGE_VALUES) onMainValuesChanged(e.params);
          markDirty();
          if (SHEET_LIST_MUTATIONS.has(e.id)) syncSheetsFromApi();
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
      markDirty();
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
        : status === "error" || status === "conflict"
          ? "Не сохранено"
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
        <div className="flex min-w-[16rem] flex-1 flex-wrap items-center gap-3">
          <Link
            href={listHref}
            className="text-sm text-[var(--muted-fg)] hover:underline"
          >
            {mode === "version" ? "← Версии" : "← Все сметы"}
          </Link>
          <h2 className="font-display truncate text-base font-semibold">
            {title ?? `Смета — ${department.name}`}
          </h2>
          <span className="font-mono text-xs text-[var(--muted-fg)]">
            {department.codePrefix}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {approval && approvalInfo ? (
            <SmetaApprovalControls
              projectId={projectId}
              departmentId={department.id}
              info={approvalInfo}
              canWrite={canWrite}
              canApprove={approval.canApprove}
              reviewHref={approval.reviewHref}
              versionsHref={approval.versionsHref}
              flushSave={flushSave}
            />
          ) : null}
          {mode === "draft" ? (
            <span
              className={cn(
                // Постоянная ширина: смена «Сохранение…» / «Сохранено …» не переносит кнопки.
                "inline-block w-40 truncate text-xs",
                status === "error"
                  ? "text-[var(--danger)]"
                  : "text-[var(--foreground)]/70",
              )}
            >
              {statusLabel}
            </span>
          ) : null}
          {canWrite ? (
            <>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={pending || status === "saving" || status === "conflict"}
                onClick={() => void flushSave()}
              >
                Сохранить
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-9"
                disabled={importing || status === "conflict"}
                title="Листы файла .xlsx добавятся в книгу листами-черновиками. Основной лист не меняется."
                onClick={() => fileInputRef.current?.click()}
              >
                {importing ? "Импорт…" : "Импорт Excel"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void importExcel(file);
                }}
              />
            </>
          ) : (
            <span className="text-xs text-[var(--foreground)]/70">
              {mode === "version"
                ? "Утверждённая версия — только чтение"
                : mode === "summary"
                  ? "Сводная книга — только чтение"
                  : "Только просмотр"}
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

      {approvalInfo ? <SmetaApprovalBanner info={approvalInfo} /> : null}

      {status === "conflict" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--row-danger)] px-4 py-2 text-sm"
        >
          <span>
            <span className="font-medium">Смету изменили в другом окне — обновите.</span>{" "}
            Несохранённые правки в этой вкладке пропадут.
          </span>
          <Button type="button" className="h-8" onClick={() => window.location.reload()}>
            Обновить
          </Button>
        </div>
      ) : status === "error" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--row-warning)] px-4 py-2 text-sm"
        >
          <span>
            <span className="font-medium">Не сохранено:</span> {saveError ?? "ошибка сервера."}{" "}
            Правки остаются в этой вкладке.
          </span>
          <Button type="button" variant="secondary" className="h-8" onClick={() => void flushSave()}>
            Повторить
          </Button>
        </div>
      ) : null}

      {importNotice ? (
        <div className="flex flex-wrap items-start gap-3 border-b border-[var(--border)] bg-[var(--row-neutral)] px-4 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              Импортированы листы: {importNotice.sheets.map((n) => `«${n}»`).join(", ")}
            </div>
            {importNotice.warnings.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[var(--muted-fg)]">
                {importNotice.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button
            type="button"
            variant="secondary"
            className="h-8"
            onClick={() => setImportNotice(null)}
          >
            Скрыть
          </Button>
        </div>
      ) : null}

      {mode === "draft" ? (
        <SmetaChecksPanel
          checks={checks}
          canRestoreHeaders={canWrite && missingHeaders.length > 0}
          onSelectRow={goToRow}
          onRestoreHeaders={restoreHeaders}
        />
      ) : null}

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
