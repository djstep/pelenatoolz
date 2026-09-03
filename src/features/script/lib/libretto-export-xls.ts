import type { ProjectType } from "@prisma/client";
import ExcelJS from "exceljs";
import { resolveColumnHeader } from "@/features/exports/lib/column-utils";
import { buildLibrettoExportCell } from "@/features/script/lib/libretto-cell-values";
import type { LibrettoScene } from "@/features/script/lib/libretto-display";
import type { LibrettoExportColumn } from "@/features/script/lib/libretto-fields";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

function setExportCellValue(
  cell: ExcelJS.Cell,
  value: ReturnType<typeof buildLibrettoExportCell>,
) {
  if (typeof value === "string") {
    cell.value = value;
    return;
  }
  cell.value = value;
}

export async function exportLibrettoXls(
  scenes: LibrettoScene[],
  projectType: ProjectType,
  columns: LibrettoExportColumn[],
  projectId: string,
  fieldLabels?: Record<string, string>,
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Либретто");

  const headerRow = sheet.addRow(columns.map((col) => resolveColumnHeader(col)));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, name: "Calibri", size: 11 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  for (const scene of scenes) {
    const row = sheet.addRow([]);
    columns.forEach((col, index) => {
      const value = buildLibrettoExportCell(
        scene,
        col.fieldIds,
        projectType,
        fieldLabels,
      );
      const cell = row.getCell(index + 1);
      setExportCellValue(cell, value);
      cell.alignment = { vertical: "top", wrapText: true };
    });
  }

  sheet.columns.forEach((column) => {
    column.width = 22;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `libretto-${projectId.slice(0, 8)}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
