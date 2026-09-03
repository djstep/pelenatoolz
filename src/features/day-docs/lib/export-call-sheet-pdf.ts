import path from "node:path";
import PDFDocument from "pdfkit";
import type { CallSheetExportModel } from "@/features/day-docs/lib/export-call-sheet";
import { actorRoleTypeLabels } from "@/shared/i18n/domain-labels";

const FONT_REGULAR = path.join(
  process.cwd(),
  "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf",
);
const FONT_BOLD = path.join(
  process.cwd(),
  "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf",
);

function joinParts(parts: (string | null | undefined)[], sep = " · ") {
  return parts.filter(Boolean).join(sep) || "—";
}

type PdfDoc = InstanceType<typeof PDFDocument>;

function ensureSpace(doc: PdfDoc, height = 60) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function sectionTitle(doc: PdfDoc, title: string) {
  ensureSpace(doc, 40);
  doc.moveDown(0.5);
  doc.font("Bold").fontSize(12).text(title);
  doc.font("Regular").fontSize(9);
  doc.moveDown(0.25);
}

function keyValue(doc: PdfDoc, label: string, value: string) {
  ensureSpace(doc, 20);
  doc.font("Bold").text(`${label}: `, { continued: true });
  doc.font("Regular").text(value);
}

function drawTable(
  doc: PdfDoc,
  headers: string[],
  rows: string[][],
  colWidths?: number[],
) {
  if (rows.length === 0) return;

  const pageWidth =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths =
    colWidths ??
    headers.map(() => pageWidth / headers.length);
  const rowHeight = 16;
  const headerHeight = 18;

  function drawRow(cells: string[], bold = false) {
    ensureSpace(doc, rowHeight + 4);
    const y = doc.y;
    let x = doc.page.margins.left;

    doc.font(bold ? "Bold" : "Regular").fontSize(8);
    for (let i = 0; i < headers.length; i += 1) {
      const cell = cells[i] ?? "";
      doc.text(cell, x + 2, y, {
        width: widths[i]! - 4,
        height: rowHeight,
        ellipsis: true,
        lineBreak: false,
      });
      x += widths[i]!;
    }

    doc
      .moveTo(doc.page.margins.left, y + rowHeight)
      .lineTo(doc.page.width - doc.page.margins.right, y + rowHeight)
      .strokeColor("#cccccc")
      .stroke();

    doc.y = y + rowHeight + 2;
  }

  ensureSpace(doc, headerHeight + 4);
  const y0 = doc.y;
  doc
    .rect(doc.page.margins.left, y0 - 2, pageWidth, headerHeight + 2)
    .fillAndStroke("#eeeeee", "#cccccc");
  doc.fillColor("#000000");

  let x = doc.page.margins.left;
  doc.font("Bold").fontSize(8);
  for (let i = 0; i < headers.length; i += 1) {
    doc.text(headers[i]!, x + 2, y0, {
      width: widths[i]! - 4,
      height: headerHeight,
      lineBreak: false,
    });
    x += widths[i]!;
  }
  doc.y = y0 + headerHeight;

  doc.font("Regular");
  for (const row of rows) {
    drawRow(row);
  }

  doc.moveDown(0.5);
}

export async function buildCallSheetPdf(
  model: CallSheetExportModel,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("Regular", FONT_REGULAR);
    doc.registerFont("Bold", FONT_BOLD);
    doc.font("Regular");

    doc.font("Bold").fontSize(16).text(model.documentTitle);
    doc.font("Bold").fontSize(12).text(model.projectName);
    doc
      .font("Regular")
      .fontSize(10)
      .text(
        `${model.dateLabel}${model.city ? ` · ${model.city}` : ""}`,
      );
    doc.text(`${model.headerLine} · ${model.badges.join(" · ")}`);
    doc.moveDown(0.5);

    const metaCols = 3;
    const metaPerCol = Math.ceil(model.meta.length / metaCols);
    for (let i = 0; i < metaPerCol; i += 1) {
      ensureSpace(doc, 14);
      const line = Array.from({ length: metaCols }, (_, col) => {
        const item = model.meta[i + col * metaPerCol];
        return item ? `${item.label}: ${item.value}` : "";
      })
        .filter(Boolean)
        .join("    ");
      doc.fontSize(8).text(line);
    }

    if (model.notes) {
      doc.moveDown(0.25);
      doc.font("Bold").fontSize(9).text("Примечание: ", { continued: true });
      doc.font("Regular").text(model.notes);
    }

    if (model.departments.length > 0) {
      sectionTitle(doc, "Руководители группы / контакты по цехам");
      for (const d of model.departments) {
        keyValue(doc, d.role, `${d.person} — ${d.info}`);
      }
    }

    if (model.transports.length > 0) {
      sectionTitle(doc, "Спецтранспорт");
      for (const t of model.transports) {
        keyValue(doc, t.name, joinParts([t.info, t.notes]));
      }
    }

    sectionTitle(doc, "Расписание дня");
    if (model.slots.length === 0) {
      doc.text("Расписание по слотам не задано.");
    } else {
      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      drawTable(
        doc,
        ["Время", "Тип", "Содержание"],
        model.slots.map((slot) => [
          `${slot.timeRange}${slot.duration ? ` (${slot.duration})` : ""}`,
          slot.typeLabel,
          joinParts([
            slot.title,
            slot.notes,
            slot.details.length ? slot.details.join("; ") : null,
          ]),
        ]),
        [70, 90, pageWidth - 160],
      );
    }

    sectionTitle(doc, "Актёры");
    drawTable(
      doc,
      [
        "Персонаж",
        "Актёр",
        "Сцены",
        "Подача",
        "Прибытие",
        "Костюм",
        "Грим",
        "Готов",
        "Конец",
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
          ])
        : [["—", "В сценах дня нет персонажей", "", "", "", "", "", "", ""]],
    );

    if (model.perShiftResources.length > 0) {
      sectionTitle(doc, "Посменные ресурсы");
      drawTable(
        doc,
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
      sectionTitle(doc, section.title);
      const headers = [
        "Наименование",
        "Сцены",
        "Прибытие",
        ...(section.showCostume ? ["Костюм"] : []),
        ...(section.showMakeup ? ["Грим"] : []),
        "Готовность",
        "Конец",
      ];
      drawTable(
        doc,
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

    sectionTitle(doc, "Сцены дня (сводка)");
    {
      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      drawTable(
        doc,
        ["Сцена", "Персонажи", "Хрон."],
        model.scenesSummary.length > 0
          ? model.scenesSummary.map((row) => [
              row.scene,
              row.characters,
              row.timing,
            ])
          : [["—", "В дне нет сцен", ""]],
        [120, pageWidth - 180, 60],
      );
    }

    if (model.locationsSummary) {
      keyValue(doc, "Объекты", model.locationsSummary);
    }

    if (model.nextDay) {
      sectionTitle(doc, "Следующий съёмочный день");
      keyValue(doc, "День", model.nextDay.label);
      if (model.nextDay.astro) keyValue(doc, "Погода", model.nextDay.astro);
      keyValue(doc, "Сцены", model.nextDay.scenes);
      if (model.nextDay.locations) {
        keyValue(doc, "Объекты", model.nextDay.locations);
      }
    }

    doc.end();
  });
}
