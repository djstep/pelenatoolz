import ExcelJS from "exceljs";
import type { Writable } from "node:stream";
import type {
  CallSheetPrintCastRow,
  CallSheetPrintElementRow,
  CallSheetPrintModel,
  CallSheetPrintPlanRow,
} from "@/features/call-sheets/print/print-model";
import { excelSafe } from "@/shared/lib/excel-safe";

/**
 * Вызывной лист в Excel: модель → книга с одним листом. Чистая сборка, без базы.
 * Блоки — в том же порядке, что на печатном листе (`buildCallSheetHtml`): шапка, времена,
 * погода, объекты, ограничения по актёрам, «Важно», руководители, вызов цехов, база,
 * актёры, групповка, элементы, план основного юнита, второй юнит, схема объекта.
 * У блока — строка-заголовок жирным, строка шапки колонок и строки данных; между блоками —
 * пустая строка. Пустые блоки и колонки без единого значения не выводятся (как в HTML).
 * Все строки ячеек — через `excelSafe`. Ставки км в модели нет, телефонов актёров — тоже.
 */

export const CALL_SHEET_XLSX_SHEET_NAME = "Вызывной";

type CellValue = string | null | undefined;

const MIN_WIDTH = 8;
const MAX_WIDTH = 32;
/** Колонка длинного текста (содержание строки плана) может быть шире. */
const WIDE_MAX_WIDTH = 60;
const LINE_HEIGHT = 15;

const TITLE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF1EA" } };
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
const SERVICE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEB" } };
const LUNCH_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF1EA" } };
const THIN: ExcelJS.Border = { style: "thin", color: { argb: "FFD9D9D4" } };

/** Строка на всю ширину листа (заголовок блока или длинный текст) — объединяется в конце. */
type WideRow = { row: number; fromCol: number; text: string };

class SheetWriter {
  private wide: WideRow[] = [];
  private titles = new Set<number>();
  private maxCol = 1;
  /** Ячейки «строка:колонка», которым можно ширину до `WIDE_MAX_WIDTH`. */
  private wideCells = new Set<string>();
  private hasBlock = false;

  constructor(readonly sheet: ExcelJS.Worksheet) {}

  /** Единственная точка записи значений: каждая строка — через `excelSafe`. */
  addRow(values: CellValue[]): ExcelJS.Row {
    const row = this.sheet.addRow(values.map((value) => (value == null ? null : excelSafe(value))));
    this.maxCol = Math.max(this.maxCol, values.length);
    return row;
  }

  /** Заголовок блока; перед ним — пустая строка (кроме первого блока). */
  title(text: string) {
    if (this.hasBlock) this.sheet.addRow([]);
    this.hasBlock = true;
    const row = this.addRow([text]);
    const cell = row.getCell(1);
    cell.font = { bold: true, size: 12 };
    cell.fill = TITLE_FILL;
    cell.border = { bottom: { style: "medium", color: { argb: "FF121212" } } };
    this.titles.add(row.number);
    this.wide.push({ row: row.number, fromCol: 1, text });
  }

  /** Шапка колонок таблицы. */
  header(values: string[]) {
    const row = this.addRow(values);
    row.eachCell((cell) => {
      cell.font = { bold: true, size: 9, color: { argb: "FF3A3A3A" } };
      cell.fill = HEAD_FILL;
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { bottom: THIN };
    });
    return row;
  }

  /** Строка данных: перенос текста, выравнивание по верху, тонкая линия снизу. */
  data(values: CellValue[], wideCol?: number) {
    const row = this.addRow(values);
    if (wideCol) this.wideCells.add(`${row.number}:${wideCol}`);
    for (let col = 1; col <= values.length; col++) {
      const cell = row.getCell(col);
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = { bottom: THIN };
    }
    return row;
  }

  /** Текст на всю ширину листа; с подписью — подпись в первой колонке, текст со второй. */
  text(value: string, label?: string) {
    const row = this.addRow(label ? [label, value] : [value]);
    const fromCol = label ? 2 : 1;
    if (label) {
      row.getCell(1).font = { bold: true };
      row.getCell(1).alignment = { vertical: "top" };
    }
    row.getCell(fromCol).alignment = { vertical: "top", wrapText: true };
    this.wide.push({ row: row.number, fromCol, text: value });
    return row;
  }

  /** Ширины колонок по содержимому, объединение широких строк, высота для них. */
  finish() {
    const lastCol = Math.max(this.maxCol, 3);
    const wideRows = new Map(this.wide.map((w) => [w.row, w.fromCol] as const));
    const widths = new Array<number>(lastCol + 1).fill(MIN_WIDTH);
    this.sheet.eachRow((row, rowNumber) => {
      // У широкой строки с подписью меряется только подпись; без подписи — ничего.
      const wide = wideRows.get(rowNumber);
      row.eachCell((cell, col) => {
        if (typeof cell.value !== "string" || col > lastCol) return;
        if (wide !== undefined && col >= wide) return;
        const max = this.wideCells.has(`${rowNumber}:${col}`) ? WIDE_MAX_WIDTH : MAX_WIDTH;
        const longest = Math.max(...cell.value.split("\n").map((line) => line.length));
        widths[col] = Math.max(widths[col]!, Math.min(max, longest + 2));
      });
    });
    for (let col = 1; col <= lastCol; col++) this.sheet.getColumn(col).width = widths[col];

    for (const w of this.wide) {
      if (w.fromCol < lastCol) this.sheet.mergeCells(w.row, w.fromCol, w.row, lastCol);
      if (this.titles.has(w.row)) continue;
      const chars = widths.slice(w.fromCol, lastCol + 1).reduce((sum, width) => sum + width, 0);
      const lines = w.text
        .split("\n")
        .reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * 1.1) / chars)), 0);
      this.sheet.getRow(w.row).height = Math.max(1, lines) * LINE_HEIGHT;
    }
  }
}

// ---- Таблицы со скрытием пустых колонок (как `columnsFor` в HTML) ----

type Column<R> = { head: string; value: (row: R) => CellValue; always?: boolean };

function visibleColumns<R>(columns: Column<R>[], rows: R[]) {
  return columns.filter((col) => col.always || rows.some((row) => Boolean(col.value(row))));
}

function table<R>(w: SheetWriter, columns: Column<R>[], rows: R[]) {
  const cols = visibleColumns(columns, rows);
  w.header(cols.map((col) => col.head));
  for (const row of rows) w.data(cols.map((col) => col.value(row)));
  return cols;
}

// ---- Блоки ----

function sceneWord(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "сцена";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "сцены";
  return "сцен";
}

function headBlock(w: SheetWriter, model: CallSheetPrintModel) {
  w.title("ВЫЗЫВНОЙ ЛИСТ");
  const name = w.text(model.projectName);
  name.getCell(1).font = { bold: true, size: 16 };
  w.text(model.dateLabel).getCell(1).font = { bold: true, size: 11 };
  const meta = [
    model.shiftNumber ? `Смена №${model.shiftNumber}` : null,
    model.nightShift ? "ночная смена" : null,
    model.dayOfTotalLabel,
    model.totals.sceneCount ? `${model.totals.sceneCount} ${sceneWord(model.totals.sceneCount)}` : null,
    model.totals.dayTiming ? `хронометраж дня ${model.totals.dayTiming}` : null,
  ].filter(Boolean);
  if (meta.length) w.text(meta.join(" · "));
  if (model.crewCall.time) w.text(model.crewCall.time, "Сбор группы");
  if (model.crewCall.address) {
    w.text(`${model.crewCall.address}${model.scheme ? " (схема — в конце)" : ""}`, "Место сбора");
  }
}

function timesBlock(w: SheetWriter, model: CallSheetPrintModel) {
  if (model.times.length === 0) return;
  w.title("ВРЕМЕНА");
  w.header(model.times.map((time) => time.label));
  const row = w.data(model.times.map((time) => time.value));
  model.times.forEach((time, i) => {
    row.getCell(i + 1).font = { bold: true, color: time.accent ? { argb: "FFD24A0C" } : undefined };
  });
}

function weatherBlock(w: SheetWriter, model: CallSheetPrintModel) {
  const weather = model.weather;
  if (!weather) return;
  w.title("ПОГОДА");
  table<NonNullable<CallSheetPrintModel["weather"]>>(
    w,
    [
      { head: "Погода", value: (r) => r.summary },
      { head: "Днём", value: (r) => r.tempDay },
      { head: "Ночью", value: (r) => r.tempNight },
      { head: "Восход", value: (r) => r.sunrise },
      { head: "Закат", value: (r) => r.sunset },
    ],
    [weather],
  );
}

function locationsBlock(w: SheetWriter, model: CallSheetPrintModel) {
  if (model.locations.length === 0) return;
  const several = model.locations.length > 1 || model.locations[0]!.rows.length > 1;
  w.title(several ? "ОБЪЕКТЫ" : "ОБЪЕКТ");
  type Row = { address: string | null; name: string; scenes: string | null };
  const rows: Row[] = model.locations.flatMap((group) =>
    group.rows.map((row, i) => ({
      address: i === 0 ? group.address : null,
      name: row.name,
      scenes: row.secondUnit ? "2-й юнит" : row.scenes,
    })),
  );
  table<Row>(
    w,
    [
      { head: "Адрес", value: (r) => r.address },
      { head: "Объект", value: (r) => r.name, always: true },
      { head: "Сцены", value: (r) => r.scenes },
    ],
    rows,
  );
}

function textBlocks(w: SheetWriter, model: CallSheetPrintModel) {
  if (model.actorRestrictions) {
    w.title("ОГРАНИЧЕНИЯ ПО АКТЁРАМ");
    w.text(model.actorRestrictions);
  }
  if (model.important) {
    w.title("ВАЖНО");
    w.text(model.important).getCell(1).font = { bold: true };
  }
}

function leadersBlock(w: SheetWriter, model: CallSheetPrintModel) {
  if (model.leaders.length === 0) return;
  w.title("РУКОВОДИТЕЛИ ГРУППЫ");
  table<CallSheetPrintModel["leaders"][number]>(
    w,
    [
      { head: "Должность", value: (r) => r.position, always: true },
      { head: "Фамилия имя", value: (r) => r.name },
      { head: "Телефон", value: (r) => r.phone },
    ],
    model.leaders,
  );
}

function crewBlock(w: SheetWriter, model: CallSheetPrintModel) {
  if (model.crewCalls.length === 0) return;
  w.title("ВЫЗОВ ЦЕХОВ");
  table<CallSheetPrintModel["crewCalls"][number]>(
    w,
    [
      { head: "Цех", value: (r) => r.label, always: true },
      { head: "Вызов", value: (r) => r.time },
    ],
    model.crewCalls,
  );
}

function baseBlock(w: SheetWriter, model: CallSheetPrintModel) {
  if (model.baseItems.length === 0) return;
  w.title("БАЗА И ТРАНСПОРТ ГРУППЫ");
  table<CallSheetPrintModel["baseItems"][number]>(
    w,
    [
      { head: "Что", value: (r) => r.name, always: true },
      { head: "Прибытие на базу", value: (r) => (r.notNeeded ? "не нужен" : r.time) },
    ],
    model.baseItems,
  );
}

function castBlock(w: SheetWriter, model: CallSheetPrintModel) {
  if (model.cast.length === 0) return;
  w.title("АКТЁРЫ");
  table<CallSheetPrintCastRow>(
    w,
    [
      { head: "Персонаж", value: (r) => r.character, always: true },
      { head: "Актёр", value: (r) => r.actor },
      { head: "Сцены", value: (r) => r.scenes },
      { head: "Транспорт", value: (r) => r.transport?.text },
      { head: "Подача машины", value: (r) => r.carPickup },
      { head: "Прибытие", value: (r) => r.arrival },
      { head: "Костюм", value: (r) => r.costume },
      { head: "Грим", value: (r) => r.makeup },
      { head: "Готов", value: (r) => r.ready },
      { head: "Конец", value: (r) => r.wrap },
    ],
    model.cast,
  );
}

function rowTimeColumns(): Column<CallSheetPrintElementRow>[] {
  return [
    { head: "Сцены", value: (r) => r.scenes },
    { head: "Прибытие", value: (r) => r.arrival },
    { head: "Готов", value: (r) => r.ready },
    { head: "Конец", value: (r) => r.wrap },
    { head: "Юнит", value: (r) => (r.secondUnit ? "2-й юнит" : null) },
    { head: "Примечание", value: (r) => r.notes },
  ];
}

function groupsBlock(w: SheetWriter, model: CallSheetPrintModel) {
  if (model.groups.length === 0) return;
  w.title("ГРУППОВКА И ДУБЛЁРЫ");
  table<CallSheetPrintElementRow>(
    w,
    [
      { head: "Кто", value: (r) => r.name, always: true },
      { head: "Чел.", value: (r) => r.quantity },
      ...rowTimeColumns(),
    ],
    model.groups,
  );
}

function elementsBlock(w: SheetWriter, model: CallSheetPrintModel) {
  const sections = model.elementSections;
  if (sections.length === 0) return;
  w.title("ЭЛЕМЕНТЫ ПЛОЩАДКИ");
  type Row = CallSheetPrintElementRow & { section: string | null };
  // Раздел — в первой строке своих строк (как объединённая ячейка в HTML).
  const rows: Row[] = sections.flatMap((section) =>
    section.rows.map((row, i) => ({ ...row, section: i === 0 ? section.name : null })),
  );
  const cols = visibleColumns<Row>(
    [
      { head: "Раздел", value: (r) => r.section, always: true },
      { head: "Что", value: (r) => r.name, always: true },
      { head: "Кол-во", value: (r) => r.quantity },
      ...rowTimeColumns(),
    ],
    rows,
  );
  w.header(cols.map((col) => col.head));
  for (const row of rows) {
    const line = w.data(cols.map((col) => col.value(row)));
    if (row.section) {
      line.getCell(1).font = { bold: true, size: 9 };
      line.eachCell((cell) => {
        cell.border = { ...cell.border, top: { style: "thin", color: { argb: "FF3A3A3A" } } };
      });
    }
  }
}

/** Ячейка «Объект · содержание · элементы» строки плана — строками. */
function planContent(row: CallSheetPrintPlanRow): string {
  if (row.kind === "service") return [row.label, row.note].filter(Boolean).join(" · ");
  const slug = [[row.intExtLabel, row.title].filter(Boolean).join(" "), row.mode]
    .filter(Boolean)
    .join(" · ");
  return [
    slug,
    row.synopsis,
    ...row.elements.map((el) => `${el.label}: ${el.value}`),
    row.note ? `Примечание: ${row.note}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const PLAN_HEAD = ["Время", "Длит.", "Сцена", "Объект · содержание · элементы", "Персонажи", "Хрон."];
const PLAN_CONTENT_COL = 4;

function planRows(w: SheetWriter, rows: CallSheetPrintPlanRow[]) {
  w.header(PLAN_HEAD);
  for (const row of rows) {
    const scene = row.kind === "scene";
    const line = w.data(
      [
        row.time,
        row.duration,
        scene ? row.sceneNumber : null,
        planContent(row),
        scene ? row.characters : null,
        scene ? row.timing : null,
      ],
      PLAN_CONTENT_COL,
    );
    line.getCell(1).font = { bold: true };
    if (scene) {
      line.getCell(3).font = { bold: true, size: 12 };
    } else {
      for (let col = 1; col <= PLAN_HEAD.length; col++) {
        line.getCell(col).fill = row.lunch ? LUNCH_FILL : SERVICE_FILL;
      }
      if (row.lunch) line.getCell(4).font = { bold: true, color: { argb: "FFD24A0C" } };
    }
  }
}

function planBlock(w: SheetWriter, model: CallSheetPrintModel) {
  if (model.plan.length === 0) return;
  w.title("ПЛАН СЪЁМКИ · ОСНОВНОЙ ЮНИТ");
  planRows(w, model.plan);
  if (model.totals.mainTiming) {
    const total = w.addRow([null, null, null, "Итого хронометраж основного юнита", null, model.totals.mainTiming]);
    total.font = { bold: true };
  }
}

function secondUnitBlock(w: SheetWriter, model: CallSheetPrintModel) {
  const { rows, range } = model.secondUnit;
  if (rows.length === 0) return;
  w.title("ВТОРОЙ ЮНИТ");
  if (range) w.text(range, "Время юнита");
  planRows(w, rows);
}

function schemeBlock(w: SheetWriter, model: CallSheetPrintModel) {
  const s = model.scheme;
  if (!s) return;
  w.title("СХЕМА ОБЪЕКТА");
  w.text(s.title, "Объект");
  if (s.address) w.text(s.address, "Адрес");
  if (s.points.length) {
    table<NonNullable<CallSheetPrintModel["scheme"]>["points"][number]>(
      w,
      [
        { head: "№", value: (p) => p.number, always: true },
        { head: "Точка", value: (p) => p.name, always: true },
        { head: "Описание", value: (p) => p.description },
      ],
      s.points,
    );
  }
  const texts: [string, string | null][] = [
    ["Как добраться", s.directions],
    ["Парковка", s.parking],
    ["На месте", s.onSite],
  ];
  for (const [label, value] of texts) if (value) w.text(value, label);
}

/** Чистая функция: модель листа → книга Excel с одним листом «Вызывной». */
export function buildCallSheetWorkbook(model: CallSheetPrintModel): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PELENA";
  const sheet = workbook.addWorksheet(CALL_SHEET_XLSX_SHEET_NAME, {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  const w = new SheetWriter(sheet);
  headBlock(w, model);
  timesBlock(w, model);
  weatherBlock(w, model);
  locationsBlock(w, model);
  textBlocks(w, model);
  leadersBlock(w, model);
  crewBlock(w, model);
  baseBlock(w, model);
  castBlock(w, model);
  groupsBlock(w, model);
  elementsBlock(w, model);
  planBlock(w, model);
  secondUnitBlock(w, model);
  schemeBlock(w, model);
  w.finish();
  return workbook;
}

/**
 * Пишет книгу в поток и закрывает его. Книга собирается сразу (ошибка сборки — исключением
 * до записи); ошибка записи — отклонённым обещанием, поток вызывающий закрывает с ошибкой.
 */
export function writeCallSheetXlsx(model: CallSheetPrintModel, stream: Writable): Promise<void> {
  const workbook = buildCallSheetWorkbook(model);
  return workbook.xlsx.write(stream).then(() => {
    stream.end();
  });
}
