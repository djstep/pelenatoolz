import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";

type CellData = {
  v?: string | number | boolean;
  f?: string;
  t?: number;
  s?: string;
};

type SheetData = {
  id: string;
  name: string;
  tabColor: string;
  hidden: number;
  rowCount: number;
  columnCount: number;
  zoomRatio: number;
  freeze: {
    xSplit: number;
    ySplit: number;
    startRow: number;
    startColumn: number;
  };
  scrollTop: number;
  scrollLeft: number;
  defaultColumnWidth: number;
  defaultRowHeight: number;
  mergeData: {
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
  }[];
  cellData: Record<number, Record<number, CellData>>;
  rowData: Record<number, { h?: number; hd?: number }>;
  columnData: Record<number, { w?: number; hd?: number }>;
  showGridlines: number;
  rowHeader: { width: number; hidden: number };
  columnHeader: { height: number; hidden: number };
  rightToLeft: number;
};

export type ImportWarning = {
  code: string;
  message: string;
};

export type ImportWorkbookResult = {
  workbook: Record<string, unknown>;
  warnings: ImportWarning[];
};

/** Excel functions that often fail or behave differently in Univer OSS formula engine. */
const RISKY_FORMULA_FNS = new Set([
  "LAMBDA",
  "LET",
  "FILTER",
  "SORT",
  "SORTBY",
  "UNIQUE",
  "SEQUENCE",
  "RANDARRAY",
  "XLOOKUP",
  "XMATCH",
  "GETPIVOTDATA",
  "CUBEVALUE",
  "CUBEMEMBER",
  "CUBESET",
  "WEBSERVICE",
  "FILTERXML",
  "RTD",
  "STOCKHISTORY",
  "FIELDVALUE",
  "PY",
  "IMAGE",
  "CAMERA",
]);

type SheetJsStyle = {
  patternType?: string;
  fgColor?: { rgb?: string; theme?: number; indexed?: number };
  bgColor?: { rgb?: string };
  font?: {
    name?: string;
    sz?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean | number;
    color?: { rgb?: string; theme?: number };
  };
  fill?: {
    patternType?: string;
    fgColor?: { rgb?: string };
    bgColor?: { rgb?: string };
  };
  border?: Record<
    string,
    { style?: string; color?: { rgb?: string } } | undefined
  >;
  alignment?: {
    horizontal?: string;
    vertical?: string;
    wrapText?: boolean;
  };
  numFmt?: string;
};

function warnUnique(list: ImportWarning[], code: string, message: string) {
  if (list.some((w) => w.code === code && w.message === message)) return;
  list.push({ code, message });
}

function rgbToUniver(rgb?: string): string | undefined {
  if (!rgb) return undefined;
  const clean = rgb.replace(/^#/, "").toUpperCase();
  if (clean.length === 6) return clean;
  if (clean.length === 8) return clean.slice(2); // AARRGGBB → RRGGBB
  return undefined;
}

function mapBorderStyle(style?: string): number {
  switch ((style ?? "").toLowerCase()) {
    case "hair":
    case "dotted":
    case "dashdot":
    case "dashdotdot":
    case "dashed":
      return 2;
    case "medium":
    case "thick":
    case "double":
      return 3;
    case "thin":
    default:
      return 1;
  }
}

function styleKey(parts: unknown): string {
  return `s_${Buffer.from(JSON.stringify(parts)).toString("base64url").slice(0, 24)}`;
}

function mapCellStyle(
  cellStyle: SheetJsStyle | undefined,
  numberFormat: string | undefined,
  styles: Record<string, Record<string, unknown>>,
  styleStats: { mapped: number; skipped: number },
): string | undefined {
  const hasVisual =
    cellStyle &&
    (cellStyle.font ||
      cellStyle.fill ||
      cellStyle.border ||
      cellStyle.alignment ||
      cellStyle.numFmt);
  if (!hasVisual && !numberFormat) {
    return undefined;
  }

  // Community SheetJS often omits rich style objects for xlsx — track honesty.
  if (!hasVisual && numberFormat) {
    const key = styleKey({ n: numberFormat });
    if (!styles[key]) {
      styles[key] = { n: { pattern: numberFormat } };
    }
    styleStats.mapped += 1;
    return key;
  }

  if (!cellStyle) {
    styleStats.skipped += 1;
    return undefined;
  }

  const univer: Record<string, unknown> = {};
  const font = cellStyle.font;
  if (font?.name) univer.ff = font.name;
  if (typeof font?.sz === "number") univer.fs = font.sz;
  if (font?.bold) univer.bl = 1;
  if (font?.italic) univer.it = 1;
  if (font?.underline) univer.ul = { s: 1 };
  const fontRgb = rgbToUniver(font?.color?.rgb);
  if (fontRgb) univer.cl = { rgb: fontRgb };

  const fillRgb =
    rgbToUniver(cellStyle.fill?.fgColor?.rgb) ??
    rgbToUniver(cellStyle.fgColor?.rgb);
  if (fillRgb) univer.bg = { rgb: fillRgb };

  if (cellStyle.border) {
    const bd: Record<string, unknown> = {};
    const sides: Array<[string, string]> = [
      ["t", "top"],
      ["b", "bottom"],
      ["l", "left"],
      ["r", "right"],
    ];
    for (const [uKey, xKey] of sides) {
      const side = cellStyle.border[xKey];
      if (!side?.style) continue;
      const cl = rgbToUniver(side.color?.rgb) ?? "000000";
      bd[uKey] = { s: mapBorderStyle(side.style), cl: { rgb: cl } };
    }
    if (Object.keys(bd).length) univer.bd = bd;
  }

  const align = cellStyle.alignment;
  if (align?.horizontal) {
    const map: Record<string, number> = {
      left: 1,
      center: 2,
      right: 3,
      justify: 4,
    };
    if (map[align.horizontal] != null) univer.ht = map[align.horizontal];
  }
  if (align?.vertical) {
    const map: Record<string, number> = {
      top: 1,
      center: 2,
      bottom: 3,
    };
    if (map[align.vertical] != null) univer.vt = map[align.vertical];
  }
  if (align?.wrapText) univer.tb = 3;

  const nf = numberFormat || cellStyle.numFmt;
  if (nf) univer.n = { pattern: nf };

  if (Object.keys(univer).length === 0) {
    styleStats.skipped += 1;
    return undefined;
  }

  const key = styleKey(univer);
  if (!styles[key]) styles[key] = univer;
  styleStats.mapped += 1;
  return key;
}

function extractFormulaFns(formula: string): string[] {
  const names: string[] = [];
  const re = /([A-Z_][A-Z0-9_.]*)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) {
    const raw = m[1]!.toUpperCase();
    const name = raw.includes(".") ? raw.split(".").pop()! : raw;
    names.push(name);
  }
  return names;
}

function cellToUniver(
  cell: XLSX.CellObject,
  styles: Record<string, Record<string, unknown>>,
  styleStats: { mapped: number; skipped: number },
  warnings: ImportWarning[],
  riskyFns: Set<string>,
): CellData | null {
  const out: CellData = {};

  if (cell.f) {
    const formula = cell.f.startsWith("=") ? cell.f : `=${cell.f}`;
    out.f = formula;
    for (const fn of extractFormulaFns(formula)) {
      if (RISKY_FORMULA_FNS.has(fn)) riskyFns.add(fn);
    }
    if (cell.F) {
      warnUnique(
        warnings,
        "array_formula",
        "Обнаружены формулы массива Excel — в редакторе они могут считаться иначе или не поддерживаться.",
      );
    }
  }

  if (cell.t === "n" && typeof cell.v === "number") {
    out.v = cell.v;
    out.t = 2;
  } else if (cell.t === "b") {
    out.v = Boolean(cell.v);
    out.t = 3;
  } else if (cell.t === "d" && cell.v instanceof Date) {
    out.v = cell.v.toISOString().slice(0, 10);
    out.t = 1;
  } else if (cell.t === "e") {
    out.v = typeof cell.w === "string" ? cell.w : "#ERR!";
    out.t = 1;
    warnUnique(
      warnings,
      "error_cells",
      "В файле есть ячейки с ошибками Excel (#REF!, #VALUE! и т.п.) — перенесены как текст.",
    );
  } else if (cell.v != null && cell.v !== "") {
    if (typeof cell.v === "number") {
      out.v = cell.v;
      out.t = 2;
    } else if (typeof cell.v === "boolean") {
      out.v = cell.v;
      out.t = 3;
    } else {
      out.v = String(cell.v);
      out.t = 1;
    }
  } else if (typeof cell.w === "string" && cell.w && !out.f) {
    out.v = cell.w;
    out.t = 1;
  }

  const styleId = mapCellStyle(
    cell.s as SheetJsStyle | undefined,
    typeof cell.z === "string" ? cell.z : undefined,
    styles,
    styleStats,
  );
  if (styleId) out.s = styleId;

  if (out.v === undefined && !out.f && !out.s) return null;
  if (out.v === undefined && out.f) {
    out.v = "";
    out.t = 1;
  }
  return out;
}

function colWidthPx(col?: XLSX.ColInfo): number | undefined {
  if (!col) return undefined;
  if (typeof col.wpx === "number" && col.wpx > 0) return Math.round(col.wpx);
  if (typeof col.wch === "number" && col.wch > 0) {
    return Math.round(col.wch * 8);
  }
  if (typeof col.width === "number" && col.width > 0) {
    return Math.round(col.width * 8);
  }
  return undefined;
}

function rowHeightPx(row?: XLSX.RowInfo): number | undefined {
  if (!row) return undefined;
  if (typeof row.hpx === "number" && row.hpx > 0) return Math.round(row.hpx);
  if (typeof row.hpt === "number" && row.hpt > 0) {
    return Math.round(row.hpt * (96 / 72));
  }
  return undefined;
}

/** Convert .xlsx / .xls Buffer into Univer IWorkbookData via SheetJS. */
export function excelBufferToUniverWorkbook(
  buffer: ArrayBuffer | Buffer,
  workbookName = "Смета",
): ImportWorkbookResult {
  const warnings: ImportWarning[] = [];
  const nodeBuf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  const wb = XLSX.read(nodeBuf, {
    type: "buffer",
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
    cellDates: true,
    sheetStubs: false,
    bookVBA: true,
    dense: false,
  });

  if (wb.vbaraw || (wb as { VBA?: unknown }).VBA) {
    warnings.push({
      code: "vba",
      message:
        "Макросы VBA не переносятся — это вне задачи модуля сметы. Код макросов отброшен.",
    });
  }

  const sheetNames = wb.SheetNames ?? [];
  if (sheetNames.length === 0) {
    throw new Error("В файле нет листов");
  }

  const styles: Record<string, Record<string, unknown>> = {};
  const styleStats = { mapped: 0, skipped: 0 };
  const sheets: Record<string, SheetData> = {};
  const sheetOrder: string[] = [];
  const riskyFns = new Set<string>();
  let anyComments = false;
  let anyHyperlinks = false;

  sheetNames.forEach((sheetName, index) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;

    const id = `sheet-${randomUUID().slice(0, 8)}`;
    sheetOrder.push(id);

    const ref = ws["!ref"];
    const range = ref
      ? XLSX.utils.decode_range(ref)
      : { s: { r: 0, c: 0 }, e: { r: 49, c: 19 } };

    const cellData: Record<number, Record<number, CellData>> = {};
    const columnData: Record<number, { w?: number; hd?: number }> = {};
    const rowData: Record<number, { h?: number; hd?: number }> = {};

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr] as XLSX.CellObject | undefined;
        if (!cell) continue;
        if (cell.c?.length) anyComments = true;
        if (cell.l) anyHyperlinks = true;
        const mapped = cellToUniver(
          cell,
          styles,
          styleStats,
          warnings,
          riskyFns,
        );
        if (!mapped) continue;
        if (!cellData[r]) cellData[r] = {};
        cellData[r]![c] = mapped;
      }
    }

    const cols = ws["!cols"] ?? [];
    cols.forEach((col, i) => {
      const w = colWidthPx(col);
      const hidden = col?.hidden ? 1 : 0;
      if (w != null || hidden) {
        columnData[i] = {
          ...(w != null ? { w } : {}),
          ...(hidden ? { hd: 1 } : {}),
        };
      }
    });

    const rows = ws["!rows"] ?? [];
    rows.forEach((row, i) => {
      const h = rowHeightPx(row);
      const hidden = row?.hidden ? 1 : 0;
      if (h != null || hidden) {
        rowData[i] = {
          ...(h != null ? { h } : {}),
          ...(hidden ? { hd: 1 } : {}),
        };
      }
    });

    const mergeData = (ws["!merges"] ?? []).map((m) => ({
      startRow: m.s.r,
      startColumn: m.s.c,
      endRow: m.e.r,
      endColumn: m.e.c,
    }));

    // Detect worksheet-level features we don't import
    const extra = ws as Record<string, unknown>;
    if (extra["!charts"] || extra["!drawings"] || extra["!images"]) {
      warnUnique(
        warnings,
        "drawings",
        "Диаграммы, изображения и фигуры Excel не импортируются.",
      );
    }
    if (extra["!autofilter"]) {
      warnUnique(
        warnings,
        "autofilter",
        "Автофильтры Excel не переносятся (данные ячеек сохранены).",
      );
    }
    if (extra["!dataValidation"] || extra["!validations"]) {
      warnUnique(
        warnings,
        "validation",
        "Проверка данных (data validation) Excel не переносится.",
      );
    }
    if (extra["!conditionalFormats"] || extra["!condfmt"]) {
      warnUnique(
        warnings,
        "condfmt",
        "Условное форматирование Excel не переносится.",
      );
    }

    const hidden =
      wb.Workbook?.Sheets?.[index]?.Hidden === 1 ||
      wb.Workbook?.Sheets?.[index]?.Hidden === 2
        ? 1
        : 0;

    sheets[id] = {
      id,
      name: sheetName || `Лист${index + 1}`,
      tabColor: "",
      hidden,
      rowCount: Math.max(range.e.r + 50, 100),
      columnCount: Math.max(range.e.c + 10, 26),
      zoomRatio: 1,
      freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
      scrollTop: 0,
      scrollLeft: 0,
      defaultColumnWidth: 100,
      defaultRowHeight: 24,
      mergeData,
      cellData,
      rowData,
      columnData,
      showGridlines: 1,
      rowHeader: { width: 46, hidden: 0 },
      columnHeader: { height: 24, hidden: 0 },
      rightToLeft: 0,
    };
  });

  if (sheetOrder.length === 0) {
    throw new Error("В файле нет листов");
  }

  if (riskyFns.size > 0) {
    warnings.push({
      code: "risky_formulas",
      message: `Часть формул может работать иначе или не поддерживаться: ${[...riskyFns].sort().join(", ")}.`,
    });
  }

  if (styleStats.mapped === 0) {
    warnings.push({
      code: "styles_limited",
      message:
        "Базовое оформление (шрифт/заливка/границы) из Excel перенесено ограниченно или не найдено в файле. Числовые форматы, ширины столбцов, высоты строк и объединения ячеек — по возможности сохранены.",
    });
  } else if (styleStats.skipped > styleStats.mapped * 2) {
    warnings.push({
      code: "styles_partial",
      message:
        "Оформление части ячеек не удалось перенести один в один (ограничения парсера SheetJS Community).",
    });
  }

  if (anyComments) {
    warnings.push({
      code: "comments",
      message: "Комментарии к ячейкам Excel не импортируются.",
    });
  }
  if (anyHyperlinks) {
    warnings.push({
      code: "hyperlinks",
      message: "Гиперссылки сохранены только как видимый текст ячейки (без перехода).",
    });
  }

  return {
    workbook: {
      id: `imported-${randomUUID().slice(0, 8)}`,
      name: workbookName,
      appVersion: "0.25.1",
      locale: "ruRU",
      styles,
      sheetOrder,
      sheets,
    },
    warnings,
  };
}

export function csvTextToUniverWorkbook(
  text: string,
  workbookName = "Смета",
): ImportWorkbookResult {
  const warnings: ImportWarning[] = [
    {
      code: "csv_plain",
      message:
        "CSV не содержит формул, оформления и нескольких листов — импортированы только значения.",
    },
  ];

  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
  const cellData: Record<number, Record<number, CellData>> = {};
  let maxCol = 10;

  for (let r = 0; r < lines.length; r++) {
    const cols = parseCsvLine(lines[r]!);
    maxCol = Math.max(maxCol, cols.length + 2);
    cellData[r] = {};
    cols.forEach((raw, c) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      const asNum = Number(trimmed.replace(/\s/g, "").replace(",", "."));
      if (trimmed !== "" && !Number.isNaN(asNum) && /^-?\d/.test(trimmed)) {
        cellData[r]![c] = { v: asNum, t: 2 };
      } else {
        cellData[r]![c] = { v: trimmed, t: 1 };
      }
    });
  }

  const sheetId = `sheet-${randomUUID().slice(0, 8)}`;
  return {
    workbook: {
      id: `imported-csv-${randomUUID().slice(0, 8)}`,
      name: workbookName,
      appVersion: "0.25.1",
      locale: "ruRU",
      styles: {},
      sheetOrder: [sheetId],
      sheets: {
        [sheetId]: {
          id: sheetId,
          name: "Лист1",
          tabColor: "",
          hidden: 0,
          rowCount: Math.max(lines.length + 50, 100),
          columnCount: Math.max(maxCol, 26),
          zoomRatio: 1,
          freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
          scrollTop: 0,
          scrollLeft: 0,
          defaultColumnWidth: 100,
          defaultRowHeight: 24,
          mergeData: [],
          cellData,
          rowData: {},
          columnData: {},
          showGridlines: 1,
          rowHeader: { width: 46, hidden: 0 },
          columnHeader: { height: 24, hidden: 0 },
          rightToLeft: 0,
        },
      },
    },
    warnings,
  };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((ch === "," || ch === ";") && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
