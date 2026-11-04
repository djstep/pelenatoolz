import {
  crewFullName,
  groupCrewRows,
  NO_DEPARTMENT_TITLE,
  type CrewDepartment,
  type CrewGroup,
  type CrewRights,
  type CrewRow,
} from "@/features/crew/lib/crew-rules";
import type { ExportColumn, ExportFieldDef } from "@/features/exports/types";
import { formatDateShort } from "@/shared/i18n/format-date";

/** `right` — без него поля нет ни в конструкторе, ни в файле, ни в печати. */
const CREW_EXPORT_FIELDS = [
  { id: "department", label: "Цех" },
  { id: "fullName", label: "ФИО" },
  { id: "position", label: "Должность" },
  { id: "phone", label: "Телефон", right: "contacts" },
  { id: "email", label: "Почта", right: "contacts" },
  { id: "source", label: "Источник" },
  { id: "contractNumber", label: "Номер договора", right: "contracts" },
  { id: "contractDate", label: "Дата договора", right: "contracts" },
  { id: "contractStatus", label: "Статус договора", right: "contracts" },
  { id: "note", label: "Заметка" },
] as const satisfies (ExportFieldDef & { right?: "contacts" | "contracts" })[];

type CrewExportFieldId = (typeof CREW_EXPORT_FIELDS)[number]["id"];

export const CREW_ARCHIVE_GROUP_TITLE = "Архив";

const FIELD_SEPARATOR = " · ";
const CONTRACT_SEPARATOR = "; ";

/** Поля, доступные зрителю: только они предлагаются в конструкторе и попадают в выгрузку. */
export function crewExportFields(rights: CrewRights): ExportFieldDef[] {
  return CREW_EXPORT_FIELDS.filter((f) => !("right" in f) || rights[f.right]).map(({ id, label }) => ({
    id,
    label,
  }));
}

export function crewDefaultExportColumns(rights: CrewRights): ExportColumn[] {
  return crewExportFields(rights).map(({ id, label }) => ({ id, title: label, fieldIds: [id] }));
}

/**
 * Колонки, которые можно показать зрителю. Запрос браузера и сохранённая раскладка проходят через
 * эту функцию: чужие и неизвестные поля выбрасываются, колонка без полей — тоже.
 */
export function crewExportColumns(columns: ExportColumn[], rights: CrewRights): ExportColumn[] {
  const allowed = new Set(crewExportFields(rights).map((f) => f.id));
  return columns
    .map(({ id, title, fieldIds }) => ({
      id,
      title,
      fieldIds: fieldIds.filter((fieldId) => allowed.has(fieldId)),
    }))
    .filter((column) => column.fieldIds.length > 0);
}

/** В печати цех — заголовок группы, отдельная колонка его только повторяла бы. */
export function crewPrintColumns(columns: ExportColumn[]): ExportColumn[] {
  const printed = columns
    .map((column) => ({
      ...column,
      fieldIds: column.fieldIds.filter((fieldId) => fieldId !== "department"),
    }))
    .filter((column) => column.fieldIds.length > 0);
  return printed.length > 0 ? printed : columns;
}

function contractValues(row: CrewRow, value: (c: NonNullable<CrewRow["contracts"]>[number]) => string) {
  return (row.contracts ?? []).map(value).join(CONTRACT_SEPARATOR);
}

/** Строка уже собрана `toCrewRow` по правам: телефона без права в ней нет. */
function crewExportFieldValue(row: CrewRow, fieldId: string): string {
  switch (fieldId as CrewExportFieldId) {
    case "department": {
      const name = row.departmentName ?? NO_DEPARTMENT_TITLE;
      return row.archived ? `${name} (архив)` : name;
    }
    case "fullName":
      return crewFullName(row);
    case "position":
      return row.position ?? "";
    case "phone":
      return row.phone ?? "";
    case "email":
      return row.email ?? "";
    case "source":
      return row.source === "CONTRACT" ? "из договора" : "вручную";
    case "contractNumber":
      return contractValues(row, (c) => c.number);
    case "contractDate":
      return contractValues(row, (c) => formatDateShort(c.date));
    case "contractStatus":
      if (row.source === "CONTRACT" && row.contracts?.length === 0) return "договор удалён";
      return contractValues(row, (c) => c.statusName);
    case "note":
      return row.note ?? "";
    default:
      return "";
  }
}

/** Текст ячейки: значения полей колонки, пустые пропускаются. */
export function crewExportCell(row: CrewRow, column: ExportColumn): string {
  return column.fieldIds
    .map((fieldId) => crewExportFieldValue(row, fieldId))
    .filter(Boolean)
    .join(FIELD_SEPARATOR);
}

/** Как на экране, по цехам. Архив только по запросу и отдельной группой в конце. */
export function crewExportGroups(
  rows: CrewRow[],
  departments: CrewDepartment[],
  includeArchived: boolean,
): CrewGroup[] {
  const groups = groupCrewRows(
    rows.filter((r) => !r.archived),
    departments,
  );
  if (!includeArchived) return groups;
  const archived = groupCrewRows(
    rows.filter((r) => r.archived),
    departments,
  ).flatMap((g) => g.rows);
  if (archived.length === 0) return groups;
  return [
    ...groups,
    { key: "archive", departmentId: null, title: CREW_ARCHIVE_GROUP_TITLE, rows: archived },
  ];
}
