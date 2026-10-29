import ExcelJS from "exceljs";
import {
  PLAN_FACT_KIND_LABELS,
  type PlanFactNumbers,
  type PlanFactReport,
} from "@/features/smeta/lib/plan-fact";
import { excelSafe } from "@/shared/lib/excel-safe";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};
const TOTAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F2F2" },
};
const OVERRUN_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFDE2E2" },
};
const MONEY = "#,##0.00";

function numbersRow(
  sheet: ExcelJS.Worksheet,
  label: [string, string, string],
  n: PlanFactNumbers,
  opts: { bold?: boolean; fill?: ExcelJS.Fill } = {},
) {
  const row = sheet.addRow([
    ...label.map((v) => excelSafe(v)),
    n.plan,
    n.accrued,
    n.paid,
    n.remaining,
    n.percent === null ? null : n.percent / 100,
  ]);
  for (const col of [4, 5, 6, 7]) row.getCell(col).numFmt = MONEY;
  row.getCell(8).numFmt = "0.0%";
  const fill = n.overrun ? OVERRUN_FILL : opts.fill;
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (opts.bold) cell.font = { bold: true };
    if (fill) cell.fill = fill;
  });
  return row;
}

/** План/факт в Excel: как на экране — строки цехов, итоги, «Без статьи», итог проекта. */
export function buildPlanFactWorkbook(
  report: PlanFactReport,
  meta: { projectName: string; periodLabel: string; departmentLabel: string },
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PELENA";
  const sheet = workbook.addWorksheet("План-факт");

  sheet.addRow([excelSafe(`План/факт · ${meta.projectName}`)]).font = { bold: true, size: 13 };
  sheet.addRow([
    excelSafe(
      `Цех: ${meta.departmentLabel} · ${
        meta.periodLabel === "весь период"
          ? "весь период"
          : `план — целиком, факт — за период ${meta.periodLabel}`
      } · все суммы с налогом`,
    ),
  ]);
  sheet.addRow([]);

  const header = sheet.addRow([
    "Код",
    "Наименование",
    "Пометка",
    "План",
    "Начислено",
    "Оплачено",
    "Остаток",
    "Исполнение",
  ]);
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  for (const d of report.departments) {
    const title = sheet.addRow([
      excelSafe(
        `${d.name} — ${d.versionNumber ? `версия ${d.versionNumber}` : "нет утверждённой версии"}`,
      ),
    ]);
    title.font = { bold: true };
    for (const r of d.rows) {
      const marks = [
        PLAN_FACT_KIND_LABELS[r.kind],
        r.removedFromDraft ? "убрана из черновика" : "",
        r.overrun ? "перерасход" : "",
      ]
        .filter(Boolean)
        .join(", ");
      numbersRow(sheet, [r.code, r.name, marks], r);
    }
    numbersRow(sheet, ["", `Итого ${d.name}`, d.totals.overrun ? "перерасход" : ""], d.totals, {
      bold: true,
      fill: TOTAL_FILL,
    });
  }

  if (report.unassigned) {
    sheet.addRow([]);
    numbersRow(sheet, ["", "Без статьи", "начисления и платежи без кода"], report.unassigned);
  }
  sheet.addRow([]);
  numbersRow(
    sheet,
    ["", "Итого по проекту", report.project.overrun ? "перерасход" : ""],
    report.project,
    { bold: true, fill: TOTAL_FILL },
  );

  sheet.columns = [
    { width: 14 },
    { width: 40 },
    { width: 24 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 12 },
  ];
  sheet.views = [{ state: "frozen", ySplit: 4 }];
  return workbook;
}

export async function workbookToBase64(workbook: ExcelJS.Workbook) {
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}
