import type { ColumnDef } from "@/shared/hooks/use-table-layout";

export {
  LIBRETTO_COLUMNS,
  LIBRETTO_EXPORT_FIELDS,
  createDefaultExportColumns,
  createExportColumnId,
  getLibrettoFieldLabel,
  type LibrettoExportColumn,
  type LibrettoFieldDef,
  suggestedExportColumnTitle,
} from "@/features/script/lib/libretto-fields";

export const LOCATION_COLUMNS: ColumnDef[] = [
  { id: "name", label: "Название", defaultWidth: 200, minWidth: 120 },
  { id: "kind", label: "Тип", defaultWidth: 80, minWidth: 64 },
  { id: "address", label: "Адрес", defaultWidth: 160, minWidth: 100 },
  { id: "decoration", label: "Декорация", defaultWidth: 90, minWidth: 70 },
  { id: "sceneCount", label: "Сцен", defaultWidth: 72, minWidth: 56 },
  { id: "sceneNumbers", label: "Номера сцен", defaultWidth: 140, minWidth: 100 },
  { id: "characters", label: "Персонажи", defaultWidth: 160, minWidth: 100 },
  { id: "shiftCount", label: "Смен (КПП)", defaultWidth: 90, minWidth: 70 },
  { id: "estimatedShifts", label: "Смен (расч.)", defaultWidth: 90, minWidth: 70 },
  { id: "tags", label: "Теги", defaultWidth: 120, minWidth: 80 },
];
