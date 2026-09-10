import type { ColumnDef } from "@/shared/hooks/use-table-layout";

export const CONTRACT_COLUMNS: ColumnDef[] = [
  { id: "date", label: "Дата", defaultWidth: 110, minWidth: 90 },
  { id: "number", label: "Номер", defaultWidth: 120, minWidth: 80 },
  { id: "counterparty", label: "Контрагент", defaultWidth: 180, minWidth: 120 },
  { id: "company", label: "Компания", defaultWidth: 160, minWidth: 100 },
  { id: "ledgerType", label: "Ведомость", defaultWidth: 120, minWidth: 90 },
  { id: "amount", label: "Сумма", defaultWidth: 110, minWidth: 80 },
  { id: "amountWithVat", label: "С НДС", defaultWidth: 110, minWidth: 80 },
  { id: "status", label: "Статус", defaultWidth: 140, minWidth: 100 },
  { id: "summary", label: "Содержание", defaultWidth: 200, minWidth: 120 },
  { id: "tags", label: "Теги", defaultWidth: 140, minWidth: 90 },
  { id: "files", label: "Файлы", defaultWidth: 72, minWidth: 56 },
];

export const CERTIFICATE_COLUMNS: ColumnDef[] = [
  { id: "date", label: "Дата", defaultWidth: 110, minWidth: 90 },
  { id: "number", label: "Номер", defaultWidth: 120, minWidth: 80 },
  { id: "counterparty", label: "Контрагент", defaultWidth: 180, minWidth: 120 },
  { id: "company", label: "Компания", defaultWidth: 160, minWidth: 100 },
  { id: "contract", label: "Договор", defaultWidth: 140, minWidth: 100 },
  { id: "payment", label: "Платёж", defaultWidth: 140, minWidth: 100 },
  { id: "amount", label: "Сумма", defaultWidth: 110, minWidth: 80 },
  { id: "amountWithVat", label: "С НДС", defaultWidth: 110, minWidth: 80 },
  { id: "status", label: "Статус", defaultWidth: 140, minWidth: 100 },
  { id: "summary", label: "Содержание", defaultWidth: 200, minWidth: 120 },
  { id: "files", label: "Файлы", defaultWidth: 72, minWidth: 56 },
];

export const ACT_COLUMNS = CERTIFICATE_COLUMNS;
