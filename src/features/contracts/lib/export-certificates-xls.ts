import ExcelJS from "exceljs";
import type { CertificateListItem } from "@/features/contracts/queries";
import { formatDateShort } from "@/shared/i18n/format-date";

function money(n: number | string | { toString(): string } | null | undefined) {
  if (n == null) return "";
  const v = typeof n === "number" ? n : Number(n.toString());
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2 });
}

export async function exportCertificatesXls(
  rows: CertificateListItem[],
  projectId: string,
  fileSuffix = "all",
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Акты");
  sheet.addRow([
    "Дата",
    "Номер",
    "Контрагент",
    "Компания",
    "Договор",
    "Платёж",
    "Сумма",
    "НДС",
    "С НДС",
    "Статус",
    "Содержание",
    "Файлы",
  ]).font = { bold: true };

  for (const r of rows) {
    sheet.addRow([
      formatDateShort(r.date),
      r.number,
      r.counterparty.name,
      r.company.name,
      r.contract?.number ?? "",
      r.payment
        ? `${formatDateShort(r.payment.date)} ${money(r.payment.amountWithTax)}`
        : "",
      money(r.amount),
      money(r.vatAmount),
      money(r.amountWithVat),
      r.status.name,
      r.summary ?? "",
      r.files.length,
    ]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `certificates-${projectId.slice(0, 8)}-${fileSuffix}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
