import ExcelJS from "exceljs";
import type { ContractListItem } from "@/features/contracts/queries";
import { formatDateShort } from "@/shared/i18n/format-date";

function money(n: number | string | { toString(): string } | null | undefined) {
  if (n == null) return "";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2 });
}

export async function exportContractsXls(
  rows: ContractListItem[],
  projectId: string,
  fileSuffix = "all",
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Договоры");
  sheet.addRow([
    "Дата",
    "Номер",
    "Контрагент",
    "Компания",
    "Ведомость",
    "Сумма",
    "НДС",
    "С НДС",
    "Предварительный",
    "Статус",
    "Содержание",
    "Примечание",
    "Теги",
  ]).font = { bold: true };

  for (const r of rows) {
    sheet.addRow([
      formatDateShort(r.date),
      r.number,
      r.counterparty.name,
      r.company.name,
      r.ledgerType?.name ?? "",
      money(r.amount),
      money(r.vatAmount),
      money(r.amountWithVat),
      r.isPreliminary ? "да" : "",
      r.status.name,
      r.summary ?? "",
      r.comment ?? "",
      r.tags.join(", "),
    ]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `contracts-${projectId.slice(0, 8)}-${fileSuffix}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
