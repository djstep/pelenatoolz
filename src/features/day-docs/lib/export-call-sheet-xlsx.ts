import ExcelJS from "exceljs";
import {
  actorRoleTypeLabels,
} from "@/shared/i18n/domain-labels";
import type { CallSheetExportModel } from "@/features/day-docs/lib/export-call-sheet";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

function joinParts(parts: (string | null | undefined)[], sep = " · ") {
  return parts.filter(Boolean).join(sep) || "—";
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, name: "Calibri", size: 11 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function addTableSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: string[][],
) {
  const sheet = workbook.addWorksheet(name);
  const headerRow = sheet.addRow(headers);
  styleHeaderRow(headerRow);
  for (const row of rows) {
    const dataRow = sheet.addRow(row);
    dataRow.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
  }
  sheet.columns.forEach((col) => {
    col.width = 18;
  });
  return sheet;
}

function addSectionTitle(sheet: ExcelJS.Worksheet, title: string) {
  const row = sheet.addRow([title]);
  row.getCell(1).font = { bold: true, size: 12, name: "Calibri" };
  sheet.addRow([]);
}

export async function buildCallSheetXlsx(model: CallSheetExportModel) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PELENA";
  workbook.created = new Date();

  const info = workbook.addWorksheet("Вызывной");
  info.getColumn(1).width = 22;
  info.getColumn(2).width = 48;

  info.addRow([model.documentTitle]).getCell(1).font = { bold: true, size: 14 };
  info.addRow([model.projectName]).getCell(1).font = { bold: true, size: 12 };
  info.addRow([
    `${model.dateLabel}${model.city ? ` · ${model.city}` : ""}`,
  ]);
  info.addRow([`${model.headerLine} · ${model.badges.join(" · ")}`]);
  info.addRow([]);

  for (const item of model.meta) {
    info.addRow([item.label, item.value]);
  }

  if (model.notes) {
    info.addRow([]);
    info.addRow(["Примечание", model.notes]);
  }

  if (model.departments.length > 0) {
    info.addRow([]);
    addSectionTitle(info, "Руководители группы / контакты по цехам");
    for (const d of model.departments) {
      info.addRow([d.role, `${d.person} — ${d.info}`]);
    }
  }

  if (model.transports.length > 0) {
    info.addRow([]);
    addSectionTitle(info, "Спецтранспорт");
    for (const t of model.transports) {
      info.addRow([
        t.name,
        joinParts([t.info, t.notes]),
      ]);
    }
  }

  if (model.nextDay) {
    info.addRow([]);
    addSectionTitle(info, "Следующий съёмочный день");
    info.addRow(["День", model.nextDay.label]);
    if (model.nextDay.astro) info.addRow(["Погода", model.nextDay.astro]);
    info.addRow(["Сцены", model.nextDay.scenes]);
    if (model.nextDay.locations) {
      info.addRow(["Объекты", model.nextDay.locations]);
    }
  }

  addTableSheet(
    workbook,
    "Расписание",
    ["Время", "Тип", "Длительность", "Содержание", "Детали"],
    model.slots.length > 0
      ? model.slots.map((slot) => [
          slot.timeRange,
          slot.typeLabel,
          slot.duration ?? "",
          slot.title ?? slot.notes ?? "",
          slot.details.join("\n"),
        ])
      : [["—", "Расписание по слотам не задано", "", "", ""]],
  );

  addTableSheet(
    workbook,
    "Актёры",
    [
      "Персонаж",
      "Актёр",
      "Сцены",
      "Подача",
      "Прибытие",
      "Костюм",
      "Грим",
      "Готовность",
      "Конец",
      "Контакт",
    ],
    model.cast.length > 0
      ? model.cast.map((row) => [
          row.characterName,
          joinParts([
            row.actorName ?? "не назначен",
            row.roleType
              ? actorRoleTypeLabels[
                  row.roleType as keyof typeof actorRoleTypeLabels
                ]
              : null,
          ]),
          row.sceneNumbers.join(", "),
          row.pickup ?? "",
          row.arrival ?? "",
          row.costume ?? "",
          row.makeup ?? "",
          row.ready ?? "",
          row.wrap ?? "",
          joinParts([row.phone, row.email]),
        ])
      : [["—", "В сценах дня нет персонажей", "", "", "", "", "", "", "", ""]],
  );

  if (model.perShiftResources.length > 0) {
    addTableSheet(
      workbook,
      "Посменные ресурсы",
      ["Категория", "Ресурс", "Прибытие", "Готовность", "Конец смены"],
      model.perShiftResources.map((row) => [
        row.categoryName,
        row.notes ? `${row.itemName} (${row.notes})` : row.itemName,
        row.arrival ?? "",
        row.ready ?? "",
        row.wrap ?? "",
      ]),
    );
  }

  for (const section of model.resourceSections) {
    const headers = [
      "Наименование",
      "Сцены",
      "Прибытие",
      ...(section.showCostume ? ["Костюм"] : []),
      ...(section.showMakeup ? ["Грим"] : []),
      "Готовность",
      "Конец",
    ];
    addTableSheet(
      workbook,
      section.title.slice(0, 31),
      headers,
      section.rows.map((row) => [
        row.name,
        row.sceneNumbers.join(", "),
        row.arrival ?? "",
        ...(section.showCostume ? [row.costume ?? ""] : []),
        ...(section.showMakeup ? [row.makeup ?? ""] : []),
        row.ready ?? "",
        row.wrap ?? "",
      ]),
    );
  }

  addTableSheet(
    workbook,
    "Сцены",
    ["Сцена", "Персонажи", "Хрон."],
    model.scenesSummary.length > 0
      ? model.scenesSummary.map((row) => [
          row.scene,
          row.characters,
          row.timing,
        ])
      : [["—", "В дне нет сцен", ""]],
  );

  if (model.locationsSummary) {
    const scenesSheet = workbook.getWorksheet("Сцены");
    if (scenesSheet) {
      scenesSheet.addRow([]);
      scenesSheet.addRow(["Объекты", model.locationsSummary]);
    }
  }

  return workbook.xlsx.writeBuffer();
}
