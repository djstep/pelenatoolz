import { randomUUID } from "node:crypto";
import {
  MAIN_HEADER_STYLE,
  createMainSheetData,
} from "@/features/smeta/lib/main-sheet";
import type { UniverWorkbookData } from "@/features/smeta/lib/workbook-model";

/** Новая книга сметы цеха: один основной лист со встроенным шаблоном. */
export function createDepartmentWorkbookSnapshot(name: string): {
  workbook: UniverWorkbookData;
  mainSheetKey: string;
} {
  const mainSheetKey = `sheet-${randomUUID().slice(0, 8)}`;
  return {
    mainSheetKey,
    workbook: {
      id: `workbook-${randomUUID().slice(0, 8)}`,
      name,
      appVersion: "0.25.1",
      locale: "ruRU",
      styles: { ...MAIN_HEADER_STYLE },
      sheetOrder: [mainSheetKey],
      sheets: { [mainSheetKey]: createMainSheetData(mainSheetKey) },
    },
  };
}
