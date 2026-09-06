import { randomUUID } from "node:crypto";
import {
  createEmptyWorkbookSnapshot,
  type UniverWorkbookData,
  type UniverWorksheetData,
} from "@/features/smeta/lib/workbook-model";

export const BUILTIN_INDUSTRY_TEMPLATE_ID = "builtin:industry";

export type SmetaTemplateOption = {
  id: string;
  name: string;
  description: string;
  isBuiltin: boolean;
};

/** Built-in film-production article skeleton for a new workbook. */
export function createIndustryTemplateSnapshot(
  name = "Смета (отраслевой шаблон)",
): UniverWorkbookData {
  const sheetId = `sheet-${randomUUID().slice(0, 8)}`;
  const rows: { title: string; qty?: number; price?: number }[] = [
    { title: "АКТЁРЫ" },
    { title: "Главные роли (посменно)", qty: 0, price: 0 },
    { title: "Второстепенные роли", qty: 0, price: 0 },
    { title: "Массовка", qty: 0, price: 0 },
    { title: "СЪЁМОЧНАЯ ГРУППА" },
    { title: "Режиссёр / оператор / звук", qty: 0, price: 0 },
    { title: "Административная группа", qty: 0, price: 0 },
    { title: "ОБОРУДОВАНИЕ" },
    { title: "Камера / свет / грип", qty: 0, price: 0 },
    { title: "ЛОКАЦИИ" },
    { title: "Аренда объектов", qty: 0, price: 0 },
    { title: "ТРАНСПОРТ" },
    { title: "Трансфер / техника", qty: 0, price: 0 },
    { title: "ПИТАНИЕ" },
    { title: "Кейтеринг / питание съёмки", qty: 0, price: 0 },
    { title: "ПОСТПРОДАКШН" },
    { title: "Монтаж / цвет / звук", qty: 0, price: 0 },
    { title: "ПРОЧЕЕ" },
    { title: "Непредвиденные расходы", qty: 0, price: 0 },
  ];

  const cellData: Record<number, Record<number, unknown>> = {
    0: {
      0: { v: "Статья", t: 1 },
      1: { v: "Кол-во", t: 1 },
      2: { v: "Цена", t: 1 },
      3: { v: "Сумма", t: 1 },
    },
  };

  rows.forEach((row, i) => {
    const r = i + 1;
    const isSection = row.qty === undefined;
    cellData[r] = {
      0: { v: row.title, t: 1 },
      ...(isSection
        ? {}
        : {
            1: { v: row.qty ?? 0, t: 2 },
            2: { v: row.price ?? 0, t: 2 },
            3: { f: `=B${r + 1}*C${r + 1}` },
          }),
    };
  });

  const sheet: UniverWorksheetData = {
    id: sheetId,
    name: "Смета",
    tabColor: "",
    hidden: 0,
    rowCount: 200,
    columnCount: 26,
    zoomRatio: 1,
    freeze: {
      xSplit: 0,
      ySplit: 1,
      startRow: 0,
      startColumn: -1,
    },
    scrollTop: 0,
    scrollLeft: 0,
    defaultColumnWidth: 100,
    defaultRowHeight: 24,
    mergeData: [],
    cellData,
    rowData: {},
    columnData: {
      0: { w: 280 },
      1: { w: 90 },
      2: { w: 110 },
      3: { w: 120 },
    },
    showGridlines: 1,
    rowHeader: { width: 46, hidden: 0 },
    columnHeader: { height: 24, hidden: 0 },
    rightToLeft: 0,
  };

  return {
    id: `workbook-${randomUUID().slice(0, 8)}`,
    name,
    appVersion: "0.25.1",
    locale: "ruRU",
    styles: {},
    sheetOrder: [sheetId],
    sheets: { [sheetId]: sheet },
  };
}

export function createBlankWorkbookSnapshot(name = "Смета"): UniverWorkbookData {
  const snap = createEmptyWorkbookSnapshot(name);
  const firstId = snap.sheetOrder[0];
  if (firstId && snap.sheets[firstId]) {
    snap.sheets[firstId] = {
      ...snap.sheets[firstId],
      cellData: {
        0: {
          0: { v: "Статья", t: 1 },
          1: { v: "Кол-во", t: 1 },
          2: { v: "Цена", t: 1 },
          3: { v: "Сумма", t: 1 },
        },
      },
    };
  }
  return snap;
}

export const BUILTIN_TEMPLATE_OPTIONS: SmetaTemplateOption[] = [
  {
    id: BUILTIN_INDUSTRY_TEMPLATE_ID,
    name: "Отраслевой шаблон",
    description:
      "Базовый набор статей кинопроизводства: актёры, группа, техника, локации, пост.",
    isBuiltin: true,
  },
];
