import "server-only";

import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { SHEET_JSON_LIMIT_BYTES } from "@/features/smeta/lib/stable-json";

/** Лимиты импорта (решение владельца, шаг 6). Главный — размер листа в JSON. */
export const IMPORT_LIMITS = {
  /** Файл: импорт идёт через серверное действие, у Vercel потолок 4,5 МБ на запрос. */
  fileBytes: 3.5 * 1024 * 1024,
  /** Всё содержимое архива в распакованном виде. */
  unpackedBytes: 50 * 1024 * 1024,
  zipEntries: 2000,
  sheetsPerImport: 20,
  /** Вторичные проверки — главный предел листа `SHEET_JSON_LIMIT_BYTES`. */
  rows: 10_000,
  columns: 200,
  cells: 200_000,
} as const;

export class ImportError extends Error {}

const MB = 1024 * 1024;
const mb = (bytes: number) =>
  `${(bytes / MB).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;

/**
 * Проверка архива .xlsx до разбора: число файлов и настоящий распакованный размер.
 * Каждый файл распаковывается с потолком — заявленным в архиве размерам не верим.
 */
export function checkZipLimits(buffer: Buffer) {
  const fail = () => {
    throw new ImportError("Файл повреждён или это не .xlsx");
  };
  // Конец центрального каталога: подпись 0x06054b50 в последних 64 КБ + 22 байта.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail();
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || offset === 0xffffffff) {
    throw new ImportError("Слишком большой архив (ZIP64) — такой файл не импортируется");
  }
  if (entries > IMPORT_LIMITS.zipEntries) {
    throw new ImportError(`В архиве файла слишком много частей (${entries})`);
  }

  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) fail();
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    offset += 46 + nameLength + extraLength + commentLength;

    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) fail();
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.length) fail();
    const left = IMPORT_LIMITS.unpackedBytes - total;
    let size: number;
    if (method === 0) {
      size = compressed;
    } else if (method === 8) {
      try {
        size = inflateRawSync(buffer.subarray(start, start + compressed), {
          maxOutputLength: left + 1,
        }).length;
      } catch (error) {
        if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") size = left + 1;
        else throw new ImportError("Файл повреждён или это не .xlsx");
      }
    } else {
      throw new ImportError("Файл сжат неизвестным способом — сохраните его в Excel заново");
    }
    total += size;
    if (total > IMPORT_LIMITS.unpackedBytes) {
      throw new ImportError(
        `Файл в распакованном виде больше ${mb(IMPORT_LIMITS.unpackedBytes)} — такой не импортируется`,
      );
    }
  }
}

type CellData = { v?: string | number | boolean; f?: string; t?: number; s?: string };

export type ParsedImport = {
  sheets: { name: string; data: Record<string, unknown> }[];
  styles: Record<string, Record<string, unknown>>;
  warnings: string[];
};

/** Имя листа, которого ещё нет: «Имя», «Имя (2)», … — до 31 знака, без запрещённых знаков. */
function freeSheetName(name: string, taken: Set<string>) {
  const base = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Лист";
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

// ---------- формулы ----------

type Segment = { kind: "text" | "string" | "sheet"; value: string };

const IDENT_START = /[A-Za-zА-Яа-яЁё_]/;
const IDENT_CHAR = /[\wА-Яа-яЁё.]/;
const UNQUOTED_SHEET = /[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё.]*!/y;

/** Формула на куски: строки в кавычках, ссылки на листы ('Лист 1'! и Лист1!) и остальное. */
function splitFormula(formula: string): Segment[] {
  const out: Segment[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ kind: "text", value: text });
    text = "";
  };
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < formula.length) {
        if (formula[j] === '"' && formula[j + 1] === '"') j += 2;
        else if (formula[j] === '"') break;
        else j++;
      }
      flush();
      out.push({ kind: "string", value: formula.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < formula.length) {
        if (formula[j] === "'" && formula[j + 1] === "'") j += 2;
        else if (formula[j] === "'") break;
        else j++;
      }
      if (formula[j + 1] === "!") {
        flush();
        out.push({ kind: "sheet", value: formula.slice(i + 1, j).replace(/''/g, "'") });
        i = j + 2;
        continue;
      }
    }
    if (IDENT_START.test(ch) && (i === 0 || !IDENT_CHAR.test(formula[i - 1]!))) {
      UNQUOTED_SHEET.lastIndex = i;
      const m = UNQUOTED_SHEET.exec(formula);
      if (m) {
        flush();
        out.push({ kind: "sheet", value: m[0].slice(0, -1) });
        i += m[0].length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

const XL_PREFIX = /_xl(fn|ws)\./gi;

type FormulaCheck = { formula: string } | { reason: FormulaReason };
type FormulaReason = "functions" | "external" | "names" | "array" | "shared" | "sheet";

/**
 * Формула Excel → формула Univer, если редактор её поймёт. Иначе причина — тогда берётся
 * вычисленное значение. Ссылки на переименованные листы файла переписываются.
 */
function convertFormula(
  formula: string,
  knownFunctions: ReadonlySet<string>,
  sheetNames: ReadonlyMap<string, string>,
  unknownFunctions: Set<string>,
): FormulaCheck {
  const segments = splitFormula(formula.replace(/^=/, ""));
  const text = segments.filter((s) => s.kind === "text").map((s) => s.value).join(" ");
  // [1]Лист!A1 — другой файл; Таблица1[Колонка] — «умная таблица» Excel.
  if (text.includes("[")) return { reason: "external" };

  for (const s of segments) {
    if (s.kind === "sheet" && !sheetNames.has(s.value.toLowerCase())) return { reason: "sheet" };
  }

  let unknown = false;
  for (const m of text.matchAll(/([A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё.]*)\s*\(/g)) {
    const name = m[1]!.toUpperCase().replace(/^_XL(FN|WS)\./, "");
    if (!knownFunctions.has(name)) {
      unknown = true;
      unknownFunctions.add(name);
    }
  }
  if (unknown) return { reason: "functions" };

  const leftover = text
    .replace(/[A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё.]*\s*\(/g, "(")
    .replace(/\$?[A-Za-z]{1,3}\$?\d+/g, "")
    .replace(/\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}/g, "")
    .replace(/\d+(\.\d+)?([eE][+-]?\d+)?/g, "")
    .replace(/\b(TRUE|FALSE)\b/gi, "")
    .replace(/#[A-Z0-9/!?]+/gi, "");
  if (/[A-Za-zА-Яа-яЁё_]/.test(leftover)) return { reason: "names" };

  const rebuilt = segments
    .map((s) => {
      if (s.kind === "string") return s.value;
      if (s.kind === "text") return s.value.replace(XL_PREFIX, "");
      const name = sheetNames.get(s.value.toLowerCase())!;
      return `'${name.replace(/'/g, "''")}'!`;
    })
    .join("");
  return { formula: `=${rebuilt}` };
}

const REASON_TEXT: Record<FormulaReason, string> = {
  functions: "функции, которых нет в редакторе",
  external: "ссылки на другие файлы или «умные таблицы» Excel",
  names: "именованные диапазоны",
  array: "формулы массива",
  shared: "общие формулы, которые не удалось развернуть",
  sheet: "ссылки на листы, которых нет в файле",
};

// ---------- значения и стили ----------

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function dateToSerial(date: Date) {
  return (date.getTime() - EXCEL_EPOCH_MS) / 86_400_000;
}

function plainValue(value: unknown): CellData | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? { v: value, t: 2 } : null;
  if (typeof value === "boolean") return { v: value, t: 3 };
  if (typeof value === "string") return { v: value, t: 1 };
  if (value instanceof Date) return { v: dateToSerial(value), t: 2 };
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.error === "string") return { v: o.error, t: 1 };
    if (Array.isArray(o.richText)) {
      return {
        v: (o.richText as { text?: string }[]).map((r) => r.text ?? "").join(""),
        t: 1,
      };
    }
    if ("text" in o) return plainValue(o.text);
  }
  return null;
}

function argbToRgb(color: unknown): string | undefined {
  const argb = (color as { argb?: unknown } | undefined)?.argb;
  if (typeof argb !== "string") return undefined;
  const clean = argb.replace(/^#/, "").toUpperCase();
  if (/^[0-9A-F]{8}$/.test(clean)) return `#${clean.slice(2)}`;
  if (/^[0-9A-F]{6}$/.test(clean)) return `#${clean}`;
  return undefined;
}

/** Univer BorderStyleTypes. */
const BORDER_STYLE: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
};

const H_ALIGN: Record<string, number> = { left: 1, center: 2, right: 3, justify: 4 };
const V_ALIGN: Record<string, number> = { top: 1, middle: 2, bottom: 3 };

function univerStyle(style: Partial<ExcelJS.Style> | undefined, numFmt: string | undefined) {
  const out: Record<string, unknown> = {};
  const font = style?.font;
  if (font?.name) out.ff = font.name;
  if (typeof font?.size === "number") out.fs = font.size;
  if (font?.bold) out.bl = 1;
  if (font?.italic) out.it = 1;
  if (font?.underline) out.ul = { s: 1 };
  if (font?.strike) out.st = { s: 1 };
  const fontRgb = argbToRgb(font?.color);
  if (fontRgb) out.cl = { rgb: fontRgb };

  const fill = style?.fill;
  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const bg = argbToRgb(fill.fgColor);
    if (bg) out.bg = { rgb: bg };
  }

  const border = style?.border;
  if (border) {
    const bd: Record<string, unknown> = {};
    for (const [key, side] of [
      ["t", border.top],
      ["b", border.bottom],
      ["l", border.left],
      ["r", border.right],
    ] as const) {
      if (!side?.style) continue;
      bd[key] = {
        s: BORDER_STYLE[side.style] ?? 1,
        cl: { rgb: argbToRgb(side.color) ?? "#000000" },
      };
    }
    if (Object.keys(bd).length) out.bd = bd;
  }

  const align = style?.alignment;
  if (align?.horizontal && H_ALIGN[align.horizontal]) out.ht = H_ALIGN[align.horizontal];
  if (align?.vertical && V_ALIGN[align.vertical]) out.vt = V_ALIGN[align.vertical];
  if (align?.wrapText) out.tb = 3;

  if (numFmt && numFmt !== "General") out.n = { pattern: numFmt };
  return Object.keys(out).length ? out : null;
}

function decodeAddress(address: string) {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(address.trim());
  if (!m) return null;
  const col = [...m[1]!.toUpperCase()].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0);
  return { row: Number(m[2]) - 1, column: col - 1 };
}

// ---------- лист ----------

/**
 * Разобрать .xlsx в листы Univer (ExcelJS). Формулы сохраняются, если редактор их понимает,
 * иначе — вычисленное значение и предупреждение. Имена листов не пересекаются с `takenNames`
 * (ссылки в формулах переписываются). Лист больше 2,5 МБ в JSON — отказ.
 */
export async function parseXlsxForUniver(
  buffer: Buffer,
  takenNames: readonly string[],
  knownFunctions: ReadonlySet<string>,
): Promise<ParsedImport> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportError("Не удалось прочитать файл — сохраните его в Excel как .xlsx");
  }

  const worksheets = workbook.worksheets;
  if (worksheets.length === 0) throw new ImportError("В файле нет листов");
  if (worksheets.length > IMPORT_LIMITS.sheetsPerImport) {
    throw new ImportError(
      `В файле ${worksheets.length} листов — за раз можно не больше ${IMPORT_LIMITS.sheetsPerImport}`,
    );
  }

  const taken = new Set(takenNames.map((n) => n.toLowerCase()));
  const sheetNames = new Map(
    worksheets.map((ws) => [ws.name.toLowerCase(), freeSheetName(ws.name, taken)]),
  );

  const tag = randomUUID().slice(0, 6);
  const styles: Record<string, Record<string, unknown>> = {};
  const styleIds = new Map<string, string>();
  const styleId = (style: Record<string, unknown>) => {
    const key = JSON.stringify(style);
    let id = styleIds.get(key);
    if (!id) {
      id = `imp${tag}_${styleIds.size + 1}`;
      styleIds.set(key, id);
      styles[id] = style;
    }
    return id;
  };

  const formulaIssues = new Map<FormulaReason, { count: number; examples: string[] }>();
  const unknownFunctions = new Set<string>();
  const notes = new Set<string>();
  const sheets: ParsedImport["sheets"] = [];

  for (const ws of worksheets) {
    const name = sheetNames.get(ws.name.toLowerCase())!;
    const rowCount = ws.rowCount;
    const columnCount = ws.columnCount;
    if (rowCount > IMPORT_LIMITS.rows || columnCount > IMPORT_LIMITS.columns) {
      throw new ImportError(
        `Лист «${ws.name}»: ${rowCount} строк × ${columnCount} колонок — предел ${IMPORT_LIMITS.rows} × ${IMPORT_LIMITS.columns}`,
      );
    }

    const cellData: Record<number, Record<number, CellData>> = {};
    const rowData: Record<number, { h?: number; hd?: number }> = {};
    const columnData: Record<number, { w?: number; hd?: number }> = {};
    let cells = 0;

    const issue = (reason: FormulaReason, address: string) => {
      const entry = formulaIssues.get(reason) ?? { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < 5) entry.examples.push(`${name}!${address}`);
      formulaIssues.set(reason, entry);
    };

    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const r = rowNumber - 1;
      const height = typeof row.height === "number" ? Math.round((row.height * 4) / 3) : undefined;
      if (height || row.hidden) {
        rowData[r] = { ...(height ? { h: height } : {}), ...(row.hidden ? { hd: 1 } : {}) };
      }

      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.type === ExcelJS.ValueType.Merge) return;
        const c = colNumber - 1;
        let out: CellData | null;

        if (cell.type === ExcelJS.ValueType.Formula) {
          const value = cell.value as {
            formula?: string;
            sharedFormula?: string;
            shareType?: string;
            result?: unknown;
          };
          out = plainValue(value.result) ?? {};
          if (value.shareType === "array") {
            issue("array", cell.address);
          } else {
            let formula: string | undefined;
            try {
              formula = cell.formula;
            } catch {
              formula = undefined;
            }
            if (!formula) {
              issue("shared", cell.address);
            } else {
              const check = convertFormula(formula, knownFunctions, sheetNames, unknownFunctions);
              if ("formula" in check) out = { ...out, f: check.formula };
              else issue(check.reason, cell.address);
            }
          }
        } else {
          if (cell.type === ExcelJS.ValueType.Hyperlink) notes.add("hyperlinks");
          if (cell.type === ExcelJS.ValueType.Error) notes.add("errors");
          out = plainValue(cell.value);
        }
        if (cell.note) notes.add("comments");

        const style = univerStyle(cell.style, cell.numFmt);
        if (style) out = { ...(out ?? {}), s: styleId(style) };
        if (!out || Object.keys(out).length === 0) return;

        cells++;
        (cellData[r] ??= {})[c] = out;
      });
    });

    if (cells > IMPORT_LIMITS.cells) {
      throw new ImportError(
        `Лист «${ws.name}»: ${cells} заполненных ячеек — предел ${IMPORT_LIMITS.cells}`,
      );
    }

    for (let i = 1; i <= columnCount; i++) {
      const col = ws.getColumn(i);
      const width = typeof col.width === "number" ? Math.round(col.width * 7 + 5) : undefined;
      if (width || col.hidden) {
        columnData[i - 1] = { ...(width ? { w: width } : {}), ...(col.hidden ? { hd: 1 } : {}) };
      }
    }

    const mergeData = ((ws.model as { merges?: string[] }).merges ?? []).flatMap((range) => {
      const [a, b] = range.split(":");
      const start = a ? decodeAddress(a) : null;
      const end = b ? decodeAddress(b) : start;
      return start && end
        ? [{ startRow: start.row, startColumn: start.column, endRow: end.row, endColumn: end.column }]
        : [];
    });

    const view = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
    const xSplit = view?.state === "frozen" ? Math.max(0, view.xSplit ?? 0) : 0;
    const ySplit = view?.state === "frozen" ? Math.max(0, view.ySplit ?? 0) : 0;

    if (ws.getImages().length > 0) notes.add("images");
    const model = ws.model as { conditionalFormattings?: unknown[]; dataValidations?: unknown };
    if (model.conditionalFormattings?.length) notes.add("conditional");
    if (
      model.dataValidations &&
      Object.keys(model.dataValidations as Record<string, unknown>).length > 0
    ) {
      notes.add("validation");
    }

    const data = {
      name,
      tabColor: argbToRgb(ws.properties?.tabColor) ?? "",
      hidden: ws.state === "visible" ? 0 : 1,
      rowCount: Math.max(rowCount + 50, 100),
      columnCount: Math.max(columnCount + 5, 26),
      zoomRatio: 1,
      freeze: {
        xSplit,
        ySplit,
        startRow: ySplit > 0 ? ySplit : -1,
        startColumn: xSplit > 0 ? xSplit : -1,
      },
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
    const bytes = Buffer.byteLength(JSON.stringify(data));
    if (bytes > SHEET_JSON_LIMIT_BYTES) {
      throw new ImportError(
        `Лист «${ws.name}» в редакторе займёт ${mb(bytes)} — предел ${mb(SHEET_JSON_LIMIT_BYTES)} на лист. Разделите его на несколько листов.`,
      );
    }
    sheets.push({ name, data });
  }

  const warnings: string[] = [];
  for (const [reason, { count, examples }] of formulaIssues) {
    const fns =
      reason === "functions" && unknownFunctions.size
        ? ` (${[...unknownFunctions].sort().slice(0, 10).join(", ")})`
        : "";
    warnings.push(
      `Формулы — ${REASON_TEXT[reason]}${fns}: ${count} шт. перенесены значениями, например ${examples.join(", ")}.`,
    );
  }
  const renamed = worksheets.filter((ws) => sheetNames.get(ws.name.toLowerCase()) !== ws.name);
  if (renamed.length) {
    warnings.push(
      `Листы с занятыми именами переименованы: ${renamed
        .map((ws) => `«${ws.name}» → «${sheetNames.get(ws.name.toLowerCase())}»`)
        .join(", ")}. Ссылки в формулах исправлены.`,
    );
  }
  const NOTE_TEXT: Record<string, string> = {
    hyperlinks: "Гиперссылки перенесены только текстом.",
    errors: "Ячейки с ошибками Excel (#ССЫЛКА!, #ЗНАЧ! и т.п.) перенесены текстом.",
    comments: "Примечания к ячейкам не переносятся.",
    images: "Картинки и диаграммы не переносятся.",
    conditional: "Условное форматирование не переносится.",
    validation: "Проверка данных (выпадающие списки) не переносится.",
  };
  for (const note of notes) warnings.push(NOTE_TEXT[note]!);

  return { sheets, styles, warnings };
}
