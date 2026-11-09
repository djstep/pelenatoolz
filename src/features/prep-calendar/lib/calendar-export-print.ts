import { loadMedeoFontCss } from "@/features/call-sheets/print/medeo-font";
import { resolveColumnHeader } from "@/features/exports/lib/column-utils";
import type { ExportColumn } from "@/features/exports/types";
import {
  calendarExportCell,
  calendarPrintColumns,
  type CalendarDayGroup,
} from "@/features/prep-calendar/lib/calendar-export";
import { escapeHtml, PRINT_HTML_CSP_META } from "@/shared/lib/escape-html";

/** Больше колонок на книжном листе не умещается: разворачиваем его. */
const PORTRAIT_MAX_COLUMNS = 5;

const e = escapeHtml;

/** Бумага белая в обеих темах интерфейса. Колонтитулов нет: только `@page`. */
function pageCss(columnCount: number) {
  const orientation = columnCount > PORTRAIT_MAX_COLUMNS ? "A4 landscape" : "A4";
  return `@page{ size:${orientation}; margin:10mm 9mm; }
:root{ color-scheme:light; }
*{ box-sizing:border-box; }
html,body{ margin:0; background:#fff; color:#121212; }
body{ font:400 9pt/1.35 "Medeo Sans",Arial,sans-serif; font-variant-numeric:tabular-nums; }
h1{ margin:0; font-size:18pt; font-weight:700; line-height:1.15; }
.project{ margin:1mm 0 5mm; color:#3a3a3a; font-size:10pt; }
table{ width:100%; border-collapse:collapse; }
thead{ display:table-header-group; }
th,td{ padding:1.2mm 1.5mm; text-align:left; vertical-align:top; overflow-wrap:break-word; }
thead th{ border-bottom:1.2pt solid #121212; font-size:8pt; font-weight:600; color:#3a3a3a; }
tbody td{ border-bottom:.5pt solid #d9d9d4; }
tr{ break-inside:avoid; }
.group th{ padding:3mm 1.5mm 1mm; border-bottom:.8pt solid #121212; font-size:10pt; font-weight:700; break-after:avoid; }
.empty{ margin-top:6mm; color:#3a3a3a; }
@media screen{ body{ max-width:277mm; margin:0 auto; padding:10mm 9mm; } }`;
}

function groupBody(group: CalendarDayGroup, columns: ExportColumn[]) {
  const rows = group.items
    .map(
      (item) =>
        `<tr>${columns.map((column) => `<td>${e(calendarExportCell(item, column)) || "—"}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<tbody><tr class="group"><th colspan="${columns.length}" scope="rowgroup">${e(group.title)}</th></tr>${rows}</tbody>`;
}

/**
 * Лист печати: события по дням, Medeo Sans встроен в страницу. Всё, что ввели люди, проходит
 * через `escapeHtml`, скриптов нет. Строки уже отобраны сервером по правам.
 */
export function buildCalendarPrintHtml(input: {
  title: string;
  period: string;
  projectName: string;
  columns: ExportColumn[];
  groups: CalendarDayGroup[];
}): string {
  const printed = calendarPrintColumns(input.columns);
  const headers = printed.map((column) => `<th scope="col">${e(resolveColumnHeader(column))}</th>`);
  const body =
    input.groups.length > 0
      ? `<table><thead><tr>${headers.join("")}</tr></thead>${input.groups.map((group) => groupBody(group, printed)).join("")}</table>`
      : `<p class="empty">За этот период событий нет.</p>`;
  return `<!DOCTYPE html><html lang="ru"><head>${PRINT_HTML_CSP_META}<meta charset="utf-8"/><title>${e(input.title)} — ${e(input.projectName)}</title>
<style>${loadMedeoFontCss()}
${pageCss(printed.length)}</style></head><body>
<h1>${e(input.title)}</h1>
<p class="project">${e(input.projectName)} · ${e(input.period)}</p>
${body}
</body></html>`;
}
