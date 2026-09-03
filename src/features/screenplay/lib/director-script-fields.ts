import type { ExportColumn } from "@/features/exports/types";
import { createExportColumnId } from "@/features/exports/lib/column-utils";
import { resourceColumnId } from "@/features/script/lib/libretto-fields";
import type { ExportFieldDef } from "@/features/exports/types";

/** Поля для конструктора режиссёрского сценария — категории ресурсов. */
export function buildDirectorScriptFields(
  resourceCategories: { id: string; name: string }[],
): ExportFieldDef[] {
  return resourceCategories.map((cat) => ({
    id: resourceColumnId(cat.id),
    label: cat.name,
  }));
}

/** По умолчанию все ресурсы в одном столбце. */
export function createDefaultDirectorColumns(
  resourceCategories: { id: string; name: string }[],
): ExportColumn[] {
  const fieldIds = resourceCategories.map((c) => resourceColumnId(c.id));
  if (fieldIds.length === 0) {
    return [
      {
        id: createExportColumnId(),
        title: "Ресурсы",
        fieldIds: [],
      },
    ];
  }
  return [
    {
      id: "resources",
      title: "Ресурсы",
      fieldIds,
    },
  ];
}
