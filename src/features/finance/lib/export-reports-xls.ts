import ExcelJS from "exceljs";
import type {
  CashFlowReport,
  PlanFactReport,
} from "@/features/finance/queries-reports";
import { formatDateShort } from "@/shared/i18n/format-date";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, name: "Calibri", size: 11 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function moneyCell(cell: ExcelJS.Cell, n: number) {
  cell.value = n;
  cell.numFmt = "#,##0.00";
}

export async function buildPlanFactWorkbook(
  report: PlanFactReport,
  meta: { projectName: string; currency: string; periodLabel: string },
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PELENA";
  const sheet = workbook.addWorksheet("План-факт");

  sheet.addRow([`План-факт по статьям · ${meta.projectName}`]);
  sheet.addRow([`Период: ${meta.periodLabel} · валюта: ${meta.currency}`]);
  sheet.addRow([]);

  const header = sheet.addRow([
    "Категория",
    "Статья",
    "План",
    "Начисления",
    "Оплачено",
    "План − начисл.",
    "Начисл. − оплачено",
  ]);
  styleHeader(header);

  for (const row of report.rows) {
    const r = sheet.addRow([
      row.categoryLabel,
      row.title,
      null,
      null,
      null,
      null,
      null,
    ]);
    moneyCell(r.getCell(3), row.planned);
    moneyCell(r.getCell(4), row.accrued);
    moneyCell(r.getCell(5), row.paid);
    moneyCell(r.getCell(6), row.variancePlan);
    moneyCell(r.getCell(7), row.unpaid);
  }

  const total = sheet.addRow([
    "",
    "Итого",
    null,
    null,
    null,
    null,
    null,
  ]);
  total.font = { bold: true };
  moneyCell(total.getCell(3), report.totals.planned);
  moneyCell(total.getCell(4), report.totals.accrued);
  moneyCell(total.getCell(5), report.totals.paid);
  moneyCell(total.getCell(6), report.totals.variancePlan);
  moneyCell(total.getCell(7), report.totals.unpaid);

  sheet.columns = [
    { width: 22 },
    { width: 36 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 18 },
  ];

  return workbook;
}

export async function buildCashFlowWorkbook(
  report: CashFlowReport,
  meta: { projectName: string; currency: string; periodLabel: string },
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PELENA";
  const sheet = workbook.addWorksheet("Движение денег");

  sheet.addRow([`Движение денег · ${meta.projectName}`]);
  sheet.addRow([`Период: ${meta.periodLabel} · валюта: ${meta.currency}`]);
  sheet.addRow([]);

  const header = sheet.addRow([
    "Дата",
    "Компания",
    "Контрагент",
    "Сумма",
    "Налог",
    "С налогом",
    "Статьи",
    "Примечание",
    "Фиксация",
  ]);
  styleHeader(header);

  for (const row of report.rows) {
    const r = sheet.addRow([
      formatDateShort(row.date),
      row.companyName,
      row.counterpartyName,
      null,
      null,
      null,
      row.breakdown.map((b) => `${b.title}: ${b.amount}`).join("; "),
      row.comment ?? "",
      row.isLocked ? "да" : "нет",
    ]);
    moneyCell(r.getCell(4), row.amount);
    moneyCell(r.getCell(5), row.taxAmount);
    moneyCell(r.getCell(6), row.amountWithTax);
  }

  const total = sheet.addRow([
    "",
    "",
    `Итого (${report.totals.count})`,
    null,
    null,
    null,
    "",
    "",
    "",
  ]);
  total.font = { bold: true };
  moneyCell(total.getCell(4), report.totals.amount);
  moneyCell(total.getCell(5), report.totals.taxAmount);
  moneyCell(total.getCell(6), report.totals.amountWithTax);

  sheet.columns = [
    { width: 12 },
    { width: 24 },
    { width: 24 },
    { width: 14 },
    { width: 12 },
    { width: 14 },
    { width: 40 },
    { width: 28 },
    { width: 10 },
  ];

  return workbook;
}

export async function workbookToBase64(workbook: ExcelJS.Workbook) {
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}

export function periodLabel(dateFrom?: string, dateTo?: string) {
  if (!dateFrom && !dateTo) return "весь период";
  if (dateFrom && dateTo) return `${dateFrom} — ${dateTo}`;
  if (dateFrom) return `с ${dateFrom}`;
  return `по ${dateTo}`;
}
