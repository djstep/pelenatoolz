import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  BorderStyle,
  ImageRun,
} from "docx";
import type {
  AuditionScheduleBreakRow,
  AuditionScheduleRow,
} from "@/features/auditions/lib/schedule-shared";
import { auditionKindLabels } from "@/features/auditions/lib/types";
import { addMinutesToTime } from "@/features/day-docs/lib/time-utils";
import { actorRoleTypeLabels, parseHhMmToMinutes } from "@/shared/i18n/domain-labels";
import { formatDateShort } from "@/shared/i18n/format-date";

export type ScheduleExportField =
  | "time"
  | "kind"
  | "photo"
  | "name"
  | "character"
  | "roleType"
  | "rating"
  | "comment"
  | "notesBlank";

export const scheduleExportFieldLabels: Record<ScheduleExportField, string> = {
  time: "Время",
  kind: "Вид пробы",
  photo: "Фото",
  name: "ФИО",
  character: "Персонаж",
  roleType: "Тип роли",
  rating: "Оценка",
  comment: "Комментарий",
  notesBlank: "Пометки (пусто)",
};

export const defaultScheduleExportFields: ScheduleExportField[] = [
  "time",
  "kind",
  "photo",
  "name",
  "character",
  "notesBlank",
];

const thin = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
};

type TimelineItem =
  | { kind: "slot"; time: string; slot: AuditionScheduleRow }
  | { kind: "break"; time: string; breakRow: AuditionScheduleBreakRow };

function breakEnd(start: string, duration: string) {
  const mins = parseHhMmToMinutes(duration);
  if (mins == null) return duration;
  return addMinutesToTime(start, mins);
}

function buildDayTimeline(
  schedules: AuditionScheduleRow[],
  breaks: AuditionScheduleBreakRow[],
): Map<string, TimelineItem[]> {
  const byDate = new Map<string, TimelineItem[]>();

  for (const s of schedules) {
    const list = byDate.get(s.dateKey) ?? [];
    list.push({ kind: "slot", time: s.time, slot: s });
    byDate.set(s.dateKey, list);
  }
  for (const b of breaks) {
    const list = byDate.get(b.dateKey) ?? [];
    list.push({ kind: "break", time: b.time, breakRow: b });
    byDate.set(b.dateKey, list);
  }

  for (const [, list] of byDate) {
    list.sort((a, b) => a.time.localeCompare(b.time));
  }
  return byDate;
}

async function fetchImageBytes(
  url: string | null | undefined,
): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const abs =
      url.startsWith("http://") || url.startsWith("https://")
        ? url
        : `${process.env.APP_URL ?? "http://localhost:3000"}${url}`;
    const res = await fetch(abs);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function textCell(text: string, width: number) {
  return new TableCell({
    borders: thin,
    width: { size: width, type: WidthType.DXA },
    children: [
      new Paragraph({
        children: [new TextRun({ text: text || " ", size: 18 })],
      }),
    ],
  });
}

export async function buildScheduleDocx(
  projectName: string,
  schedules: AuditionScheduleRow[],
  fields: ScheduleExportField[],
  breaks: AuditionScheduleBreakRow[] = [],
): Promise<Buffer> {
  const body: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `План кастинг-проб — ${projectName}`,
          bold: true,
          size: 28,
        }),
      ],
    }),
  ];

  const byDate = buildDayTimeline(schedules, breaks);
  const bodyFields = fields.filter(
    (f) => f !== "time" && f !== "kind" && f !== "comment",
  );

  for (const [dateKey, dayItems] of byDate) {
    body.push(
      new Paragraph({
        spacing: { before: 240, after: 120 },
        children: [
          new TextRun({
            text: formatDateShort(dateKey),
            bold: true,
            size: 22,
          }),
        ],
      }),
    );

    for (const item of dayItems) {
      if (item.kind === "break") {
        const b = item.breakRow;
        const parts: string[] = [];
        if (fields.includes("time")) {
          parts.push(`${b.time}–${breakEnd(b.time, b.duration)}`);
        }
        if (fields.includes("kind")) parts.push(b.label);
        if (fields.includes("comment") && b.notes) parts.push(b.notes);
        body.push(
          new Paragraph({
            spacing: { before: 120, after: 60 },
            children: [
              new TextRun({
                text: parts.join(" · ") || b.label,
                bold: true,
                italics: true,
                size: 20,
              }),
            ],
          }),
        );
        continue;
      }

      const slot = item.slot;
      const headerParts: string[] = [];
      if (fields.includes("time")) headerParts.push(slot.time);
      if (fields.includes("kind")) headerParts.push(auditionKindLabels[slot.kind]);
      if (fields.includes("comment") && slot.comment) {
        headerParts.push(slot.comment);
      }

      body.push(
        new Paragraph({
          spacing: { before: 120, after: 60 },
          children: [
            new TextRun({
              text: headerParts.join(" · ") || "Слот",
              bold: true,
              size: 20,
            }),
          ],
        }),
      );

      if (!bodyFields.length || !slot.candidates.length) continue;

      const colW = Math.floor(9000 / bodyFields.length);
      const headerCells = bodyFields.map(
        (f) =>
          new TableCell({
            borders: thin,
            width: { size: colW, type: WidthType.DXA },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: scheduleExportFieldLabels[f],
                    bold: true,
                    size: 16,
                  }),
                ],
              }),
            ],
          }),
      );

      const rows: TableRow[] = [new TableRow({ children: headerCells })];

      for (const c of slot.candidates) {
        const cells = [];
        for (const f of bodyFields) {
          if (f === "photo") {
            const bytes = await fetchImageBytes(c.person.photoUrl);
            cells.push(
              new TableCell({
                borders: thin,
                width: { size: colW, type: WidthType.DXA },
                children: [
                  bytes
                    ? new Paragraph({
                        children: [
                          new ImageRun({
                            type: "jpg",
                            data: bytes,
                            transformation: { width: 48, height: 48 },
                          }),
                        ],
                      })
                    : new Paragraph({
                        children: [new TextRun({ text: "—", size: 18 })],
                      }),
                ],
              }),
            );
          } else if (f === "name") {
            cells.push(textCell(c.person.label, colW));
          } else if (f === "character") {
            cells.push(textCell(c.character.name, colW));
          } else if (f === "roleType") {
            cells.push(
              textCell(
                c.character.roleType
                  ? actorRoleTypeLabels[c.character.roleType]
                  : "—",
                colW,
              ),
            );
          } else if (f === "rating") {
            cells.push(textCell(c.rating != null ? String(c.rating) : "—", colW));
          } else if (f === "notesBlank") {
            cells.push(textCell("", colW));
          }
        }
        rows.push(new TableRow({ children: cells }));
      }

      body.push(
        new Table({
          width: { size: 9000, type: WidthType.DXA },
          rows,
        }),
      );
    }
  }

  const doc = new Document({
    sections: [{ children: body }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

export function buildSchedulePrintHtml(
  projectName: string,
  schedules: AuditionScheduleRow[],
  fields: ScheduleExportField[],
  breaks: AuditionScheduleBreakRow[] = [],
): string {
  const byDate = buildDayTimeline(schedules, breaks);
  const show = (f: ScheduleExportField) => fields.includes(f);
  const bodyCols = fields.filter(
    (f) => f !== "time" && f !== "kind" && f !== "comment",
  );

  let html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>План проб — ${escapeHtml(projectName)}</title>
<style>
  body{font-family:system-ui,sans-serif;padding:24px;color:#111}
  h1{font-size:20px} h2{font-size:16px;margin-top:24px}
  .slot{margin:12px 0;padding:8px;border:1px solid #ccc;border-radius:8px}
  .break{margin:12px 0;padding:8px;border:1px dashed #999;border-radius:8px;background:#f8f8f8}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{border:1px solid #bbb;padding:6px;font-size:12px;vertical-align:top}
  th{background:#f3f3f3;text-align:left}
  img{width:48px;height:48px;object-fit:cover;border-radius:999px}
  .notes{min-height:40px}
  @media print{.noprint{display:none}}
</style></head><body>
<button class="noprint" onclick="window.print()">Печать / PDF</button>
<h1>План кастинг-проб — ${escapeHtml(projectName)}</h1>`;

  for (const [dateKey, dayItems] of byDate) {
    html += `<h2>${escapeHtml(formatDateShort(dateKey))}</h2>`;
    for (const item of dayItems) {
      if (item.kind === "break") {
        const b = item.breakRow;
        const head: string[] = [];
        if (show("time")) {
          head.push(`${b.time}–${breakEnd(b.time, b.duration)}`);
        }
        if (show("kind")) head.push(b.label);
        if (show("comment") && b.notes) head.push(b.notes);
        html += `<div class="break"><strong>${escapeHtml(head.join(" · ") || b.label)}</strong></div>`;
        continue;
      }

      const slot = item.slot;
      const head: string[] = [];
      if (show("time")) head.push(slot.time);
      if (show("kind")) head.push(auditionKindLabels[slot.kind]);
      if (show("comment") && slot.comment) head.push(slot.comment);
      html += `<div class="slot"><strong>${escapeHtml(head.join(" · "))}</strong>`;
      html += `<table><thead><tr>`;
      for (const f of bodyCols) {
        html += `<th>${escapeHtml(scheduleExportFieldLabels[f])}</th>`;
      }
      html += `</tr></thead><tbody>`;
      for (const c of slot.candidates) {
        html += `<tr>`;
        for (const f of bodyCols) {
          if (f === "photo") {
            html += `<td>${
              c.person.photoUrl
                ? `<img src="${escapeAttr(c.person.photoUrl)}" alt=""/>`
                : "—"
            }</td>`;
          } else if (f === "name") {
            html += `<td>${escapeHtml(c.person.label)}</td>`;
          } else if (f === "character") {
            html += `<td>${escapeHtml(c.character.name)}</td>`;
          } else if (f === "roleType") {
            html += `<td>${
              c.character.roleType
                ? escapeHtml(actorRoleTypeLabels[c.character.roleType])
                : "—"
            }</td>`;
          } else if (f === "rating") {
            html += `<td>${c.rating ?? "—"}</td>`;
          } else if (f === "notesBlank") {
            html += `<td class="notes"></td>`;
          }
        }
        html += `</tr>`;
      }
      html += `</tbody></table></div>`;
    }
  }

  html += `</body></html>`;
  return html;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string) {
  return escapeHtml(s);
}
