/**
 * Основной лист сметы цеха: обязательные колонки, шаблон, коды статей, формулы,
 * разбор строк и проверки. Без серверных зависимостей — используется и в редакторе,
 * и на сервере. Разбор строк в статьи для записи в базу делает только сервер.
 */

export const MAIN_HEADERS = [
  "Код статьи",
  "Наименование",
  "Ед.",
  "Кол-во",
  "Ставка",
  "Дни/смены",
  "Сумма",
  "Налог, %",
  "Налог",
  "Итого",
] as const;

export type MainColumn =
  | "code"
  | "name"
  | "unit"
  | "quantity"
  | "rate"
  | "days"
  | "amount"
  | "taxPercent"
  | "tax"
  | "total";

const COLUMN_KEYS: readonly MainColumn[] = [
  "code",
  "name",
  "unit",
  "quantity",
  "rate",
  "days",
  "amount",
  "taxPercent",
  "tax",
  "total",
];

export const HEADER_ROW = 0;
/** Сколько строк основного листа разбирать максимум. */
export const MAX_MAIN_ROWS = 5000;
export const MAX_CODE_LENGTH = 32;
/** Метка строки (custom данных строки Univer): глава стёр автокод — больше не ставить. */
export const NO_AUTO_CODE_KEY = "smetaNoAutoCode";

export type MainColumns = Record<MainColumn, number>;

type CellLike = { v?: unknown; f?: unknown; si?: unknown; t?: unknown } | null | undefined;
type CellData = Record<string | number, Record<string | number, CellLike> | undefined>;

export type MainSheetLike = Record<string, unknown> & { cellData?: unknown };

function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, "");
}

const HEADER_KEYS = new Map(
  MAIN_HEADERS.map((title, index) => [normalizeHeader(title), COLUMN_KEYS[index]!]),
);

function cellsOf(sheet: MainSheetLike): CellData {
  return sheet.cellData && typeof sheet.cellData === "object"
    ? (sheet.cellData as CellData)
    : {};
}

function cellAt(cells: CellData, row: number, col: number): CellLike {
  return cells[row]?.[col] ?? null;
}

function cellText(cell: CellLike): string {
  const v = cell?.v;
  if (v == null) return "";
  return String(v).trim();
}

/** Колонки ищутся по тексту заголовка, а не по месту. Повтор — берётся первый. */
export function findMainColumns(sheet: MainSheetLike): {
  columns: Partial<MainColumns>;
  missing: string[];
  duplicated: string[];
} {
  const header = cellsOf(sheet)[HEADER_ROW] ?? {};
  const columns: Partial<MainColumns> = {};
  const duplicated: string[] = [];
  const cols = Object.keys(header)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);
  for (const col of cols) {
    const key = HEADER_KEYS.get(normalizeHeader(cellText(header[col])));
    if (!key) continue;
    if (columns[key] !== undefined) {
      duplicated.push(MAIN_HEADERS[COLUMN_KEYS.indexOf(key)]!);
      continue;
    }
    columns[key] = col;
  }
  const missing = COLUMN_KEYS.filter((key) => columns[key] === undefined).map(
    (key) => MAIN_HEADERS[COLUMN_KEYS.indexOf(key)]!,
  );
  return { columns, missing, duplicated };
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Формулы Сумма, Налог, Итого для строки (row — индекс с 0). Правила те же, что у сервера:
 * пустые Кол-во и Дни = 1, пустая Ставка — пусто, пустой Налог % = 0.
 */
export function rowFormulas(columns: MainColumns, row: number) {
  const r = row + 1;
  const q = `${columnLetter(columns.quantity)}${r}`;
  const rate = `${columnLetter(columns.rate)}${r}`;
  const d = `${columnLetter(columns.days)}${r}`;
  const sum = `${columnLetter(columns.amount)}${r}`;
  const pct = `${columnLetter(columns.taxPercent)}${r}`;
  const tax = `${columnLetter(columns.tax)}${r}`;
  return {
    amount: `=IF(${rate}="","",IF(${q}="",1,${q})*${rate}*IF(${d}="",1,${d}))`,
    tax: `=IF(${sum}="","",${sum}*IF(${pct}="",0,${pct})/100)`,
    total: `=IF(${sum}="","",${sum}+${tax})`,
  };
}

/** Код сравнивается без регистра и пробелов по краям. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function codePattern(prefix: string) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}-(\\d{2,3})\\.(\\d{2,3})$`);
}

function pad(n: number) {
  return n > 99 ? String(n) : String(n).padStart(2, "0");
}

export function formatCode(prefix: string, group: number, line: number) {
  return `${prefix}-${pad(group)}.${pad(line)}`;
}

/**
 * Следующий код для строки: раздел — как у ближайшей строки выше с кодом цеха (иначе 01),
 * номер — самый большой в этом разделе + 1 среди кодов листа и всех кодов цеха (архивных тоже).
 */
export function nextCode(
  prefix: string,
  codesAbove: readonly string[],
  knownCodes: Iterable<string>,
): string {
  const pattern = codePattern(normalizeCode(prefix));
  let group = 1;
  for (let i = codesAbove.length - 1; i >= 0; i--) {
    const match = pattern.exec(normalizeCode(codesAbove[i]!));
    if (match) {
      group = Number(match[1]);
      break;
    }
  }
  let max = 0;
  for (const code of knownCodes) {
    const match = pattern.exec(normalizeCode(code));
    if (match && Number(match[1]) === group) max = Math.max(max, Number(match[2]));
  }
  return formatCode(normalizeCode(prefix), group, max + 1);
}

/** Число из ячейки: число или текст вида «1 500,50». Пусто — null, не число — NaN. */
export function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === "boolean") return Number.NaN;
  const text = String(value).replace(/[\s ]/g, "").replace(",", ".");
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : Number.NaN;
}

const SUBTOTAL_FORMULA = /(^|[^A-ZА-Я_])(SUM|СУММ)\s*\(/i;

function isSubtotalCell(cell: CellLike): boolean {
  return typeof cell?.f === "string" && SUBTOTAL_FORMULA.test(cell.f) && cell.f.includes(":");
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ParsedRow = {
  /** Индекс строки листа (с 0) */
  row: number;
  code: string;
  name: string;
  unit: string | null;
  quantity: number | null;
  rate: number | null;
  days: number | null;
  amount: number;
  taxPercent: number | null;
  tax: number;
  total: number;
};

export type CheckKind =
  | "headers"
  | "duplicate"
  | "amount_without_code"
  | "code_without_name"
  | "sheet_differs"
  | "not_a_number"
  | "code_too_long";

export type SmetaCheck = {
  kind: CheckKind;
  /** Индекс строки листа (с 0); у «headers» — 0 */
  row: number;
  message: string;
};

export type MainSheetAnalysis = {
  /** Нет обязательных заголовков: статьи не обновляются. */
  broken: boolean;
  missing: string[];
  columns: Partial<MainColumns>;
  /** Строки-статьи, по одной на код (первая строка с кодом). */
  items: ParsedRow[];
  checks: SmetaCheck[];
};

function lastRow(cells: CellData): number {
  let max = HEADER_ROW;
  for (const key of Object.keys(cells)) {
    const n = Number(key);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return Math.min(max, MAX_MAIN_ROWS);
}

function rowLabel(row: number) {
  return `Строка ${row + 1}`;
}

function money(n: number) {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

/**
 * Разбор основного листа. Раздел (только наименование) и подытог (СУММ/SUM по диапазону
 * в Сумме или Итого без кода) — не статьи и без проверок. Кол-во, Ставка, Дни, Налог %
 * берутся вычисленными значениями ячеек; Сумма, Налог, Итого считаются заново, расхождение
 * с листом — в проверки.
 */
export function analyzeMainSheet(sheet: MainSheetLike): MainSheetAnalysis {
  const { columns, missing, duplicated } = findMainColumns(sheet);
  const checks: SmetaCheck[] = [];
  if (missing.length > 0) {
    checks.push({
      kind: "headers",
      row: HEADER_ROW,
      message: `Заголовки основного листа повреждены: нет ${missing
        .map((m) => `«${m}»`)
        .join(", ")}. Статьи не обновляются, пока заголовки не восстановлены.`,
    });
    return { broken: true, missing, columns, items: [], checks };
  }
  for (const title of duplicated) {
    checks.push({
      kind: "headers",
      row: HEADER_ROW,
      message: `Заголовок «${title}» встречается дважды — учитывается первая колонка.`,
    });
  }

  const col = columns as MainColumns;
  const cells = cellsOf(sheet);
  const items: ParsedRow[] = [];
  const firstRowByCode = new Map<string, number>();
  const end = lastRow(cells);

  for (let row = HEADER_ROW + 1; row <= end; row++) {
    if (!cells[row]) continue;
    const at = (c: number) => cellAt(cells, row, c);
    const code = normalizeCode(cellText(at(col.code)));
    const name = cellText(at(col.name));

    const numbers = {
      quantity: parseNumber(at(col.quantity)?.v),
      rate: parseNumber(at(col.rate)?.v),
      days: parseNumber(at(col.days)?.v),
      taxPercent: parseNumber(at(col.taxPercent)?.v),
    };
    const sheetAmount = parseNumber(at(col.amount)?.v);
    const sheetTax = parseNumber(at(col.tax)?.v);
    const sheetTotal = parseNumber(at(col.total)?.v);

    if (!code) {
      if (isSubtotalCell(at(col.amount)) || isSubtotalCell(at(col.total))) continue;
      const hasRate = numbers.rate !== null && !Number.isNaN(numbers.rate) && numbers.rate !== 0;
      const manualSum = [
        [at(col.amount), sheetAmount],
        [at(col.total), sheetTotal],
      ].some(([cell, n]) => typeof n === "number" && !Number.isNaN(n) && n !== 0 && !(cell as CellLike)?.f);
      if (hasRate || manualSum) {
        checks.push({
          kind: "amount_without_code",
          row,
          message: `${rowLabel(row)}: есть сумма, но нет кода статьи${name ? ` («${name}»)` : ""}.`,
        });
      }
      continue;
    }

    if (code.length > MAX_CODE_LENGTH) {
      checks.push({
        kind: "code_too_long",
        row,
        message: `${rowLabel(row)}: код длиннее ${MAX_CODE_LENGTH} символов — строка не учитывается.`,
      });
      continue;
    }

    const firstRow = firstRowByCode.get(code);
    if (firstRow !== undefined) {
      checks.push({
        kind: "duplicate",
        row,
        message: `${rowLabel(row)}: код ${code} уже есть в строке ${firstRow + 1} — эта строка не учитывается.`,
      });
      continue;
    }
    firstRowByCode.set(code, row);

    const bad = (Object.keys(numbers) as (keyof typeof numbers)[]).filter((k) =>
      Number.isNaN(numbers[k]),
    );
    for (const key of bad) {
      checks.push({
        kind: "not_a_number",
        row,
        message: `${rowLabel(row)} (${code}): в «${MAIN_HEADERS[COLUMN_KEYS.indexOf(key)]}» не число — считается пустым.`,
      });
      numbers[key] = null;
    }

    if (!name) {
      checks.push({
        kind: "code_without_name",
        row,
        message: `${rowLabel(row)}: код ${code} без наименования.`,
      });
    }

    const amount =
      numbers.rate === null
        ? 0
        : round2((numbers.quantity ?? 1) * numbers.rate * (numbers.days ?? 1));
    const tax = round2((amount * (numbers.taxPercent ?? 0)) / 100);
    const total = round2(amount + tax);

    for (const [title, cell, value, expected] of [
      ["Сумма", at(col.amount), sheetAmount, amount],
      ["Налог", at(col.tax), sheetTax, tax],
      ["Итого", at(col.total), sheetTotal, total],
    ] as const) {
      if (typeof value !== "number" || Number.isNaN(value)) continue;
      if (Math.abs(value - expected) < 0.005) continue;
      checks.push({
        kind: "sheet_differs",
        row,
        message: `${rowLabel(row)} (${code}): в «${title}» ${cell?.f ? "формула даёт" : "вручную"} ${money(value)}, в статью записано ${money(expected)} по расчёту.`,
      });
    }

    items.push({
      row,
      code,
      name,
      unit: cellText(at(col.unit)) || null,
      quantity: numbers.quantity,
      rate: numbers.rate,
      days: numbers.days,
      amount,
      taxPercent: numbers.taxPercent,
      tax,
      total,
    });
  }

  return { broken: false, missing: [], columns, items, checks };
}

/** Данные основного листа для нового шаблона (Univer worksheet). */
export function createMainSheetData(sheetKey: string, name = "Смета") {
  const header: Record<number, unknown> = {};
  MAIN_HEADERS.forEach((title, index) => {
    header[index] = { v: title, t: 1, s: "smetaHeader" };
  });
  const widths = [110, 280, 70, 80, 110, 90, 120, 80, 110, 120];
  return {
    id: sheetKey,
    name,
    tabColor: "",
    hidden: 0,
    rowCount: 300,
    columnCount: 26,
    zoomRatio: 1,
    freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: -1 },
    scrollTop: 0,
    scrollLeft: 0,
    defaultColumnWidth: 100,
    defaultRowHeight: 24,
    mergeData: [],
    cellData: { [HEADER_ROW]: header },
    rowData: {},
    columnData: Object.fromEntries(widths.map((w, i) => [i, { w }])),
    showGridlines: 1,
    rowHeader: { width: 46, hidden: 0 },
    columnHeader: { height: 24, hidden: 0 },
    rightToLeft: 0,
  };
}

/** Стиль строки заголовков основного листа (workbook-level styles). */
export const MAIN_HEADER_STYLE = {
  smetaHeader: {
    bl: 1,
    bg: { rgb: "#EEF0F3" },
    vt: 2,
  },
};
