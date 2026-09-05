import { randomUUID } from "node:crypto";

export type UniverWorksheetData = Record<string, unknown> & {
  id?: string;
  name?: string;
};

export type UniverWorkbookData = {
  id: string;
  name: string;
  appVersion: string;
  locale: string;
  styles: Record<string, unknown>;
  sheetOrder: string[];
  sheets: Record<string, UniverWorksheetData>;
};

export function createDefaultWorksheet(
  sheetId: string,
  name = "Лист1",
): UniverWorksheetData {
  return {
    id: sheetId,
    name,
    tabColor: "",
    hidden: 0,
    rowCount: 200,
    columnCount: 26,
    zoomRatio: 1,
    freeze: {
      xSplit: 0,
      ySplit: 0,
      startRow: -1,
      startColumn: -1,
    },
    scrollTop: 0,
    scrollLeft: 0,
    defaultColumnWidth: 100,
    defaultRowHeight: 24,
    mergeData: [],
    cellData: {
      0: {
        0: { v: "Статья", t: 1 },
        1: { v: "Кол-во", t: 1 },
        2: { v: "Цена", t: 1 },
        3: { v: "Сумма", t: 1 },
      },
      1: {
        0: { v: "Пример", t: 1 },
        1: { v: 1, t: 2 },
        2: { v: 0, t: 2 },
        3: { f: "=B2*C2" },
      },
    },
    rowData: {},
    columnData: {
      0: { w: 220 },
      1: { w: 90 },
      2: { w: 110 },
      3: { w: 120 },
    },
    showGridlines: 1,
    rowHeader: { width: 46, hidden: 0 },
    columnHeader: { height: 24, hidden: 0 },
    rightToLeft: 0,
  };
}

export function createEmptyWorkbookSnapshot(name = "Смета"): UniverWorkbookData {
  const sheetId = `sheet-${randomUUID().slice(0, 8)}`;
  return {
    id: `workbook-${randomUUID().slice(0, 8)}`,
    name,
    appVersion: "0.25.1",
    locale: "ruRU",
    styles: {},
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: createDefaultWorksheet(sheetId, "Лист1"),
    },
  };
}

/** Assemble Univer IWorkbookData from Budget + sheets (one JSON per sheet). */
export function assembleWorkbookFromSheets(input: {
  budgetId: string;
  name: string;
  styles: unknown;
  sheets: {
    id: string;
    name: string;
    sortOrder: number;
    data: unknown | null;
  }[];
}): UniverWorkbookData {
  const ordered = [...input.sheets].sort((a, b) => a.sortOrder - b.sortOrder);
  const sheets: Record<string, UniverWorksheetData> = {};
  const sheetOrder: string[] = [];

  for (const row of ordered) {
    sheetOrder.push(row.id);
    const raw =
      row.data && typeof row.data === "object"
        ? (row.data as UniverWorksheetData)
        : createDefaultWorksheet(row.id, row.name);
    sheets[row.id] = {
      ...raw,
      id: row.id,
      name: row.name || (typeof raw.name === "string" ? raw.name : "Лист"),
    };
  }

  if (sheetOrder.length === 0) {
    const sheetId = `sheet-${randomUUID().slice(0, 8)}`;
    sheetOrder.push(sheetId);
    sheets[sheetId] = createDefaultWorksheet(sheetId, "Лист1");
  }

  return {
    id: input.budgetId,
    name: input.name,
    appVersion: "0.25.1",
    locale: "ruRU",
    styles:
      input.styles && typeof input.styles === "object"
        ? (input.styles as Record<string, unknown>)
        : {},
    sheetOrder,
    sheets,
  };
}

/** Split Univer snapshot into per-sheet rows for BudgetSheet / BudgetSheetData. */
export function splitWorkbookToSheets(snapshot: Record<string, unknown>): {
  name: string;
  styles: Record<string, unknown>;
  sheets: { id: string; name: string; sortOrder: number; data: UniverWorksheetData }[];
} {
  const sheetOrder = Array.isArray(snapshot.sheetOrder)
    ? (snapshot.sheetOrder as string[])
    : [];
  const sheetsMap =
    snapshot.sheets && typeof snapshot.sheets === "object"
      ? (snapshot.sheets as Record<string, UniverWorksheetData>)
      : {};

  const ids = sheetOrder.length > 0 ? sheetOrder : Object.keys(sheetsMap);
  const sheets = ids.map((id, index) => {
    const raw = sheetsMap[id] ?? createDefaultWorksheet(id, `Лист${index + 1}`);
    const name =
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name
        : `Лист${index + 1}`;
    return {
      id,
      name,
      sortOrder: index,
      data: { ...raw, id, name },
    };
  });

  return {
    name:
      typeof snapshot.name === "string" && snapshot.name.trim()
        ? snapshot.name
        : "Смета",
    styles:
      snapshot.styles && typeof snapshot.styles === "object"
        ? (snapshot.styles as Record<string, unknown>)
        : {},
    sheets,
  };
}
