import { loadMedeoFontCss } from "@/features/call-sheets/print/medeo-font";
import { crewExportCell, crewPrintColumns } from "@/features/crew/lib/crew-export";
import type { CrewGroup } from "@/features/crew/lib/crew-rules";
import { resolveColumnHeader } from "@/features/exports/lib/column-utils";
import type { ExportColumn } from "@/features/exports/types";
import { escapeHtml, PRINT_HTML_CSP_META } from "@/shared/lib/escape-html";

/** Больше колонок на книжном листе не умещается: разворачиваем его. */
const PORTRAIT_MAX_COLUMNS = 5;

const e = escapeHtml;

/** Бумага белая в обеих темах интерфейса. Колонтитулов нет: только `@page` и поток таблицы. */
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
td.nowrap{ white-space:nowrap; }
td.long{ overflow-wrap:anywhere; }
thead th{ border-bottom:1.2pt solid #121212; font-size:8pt; font-weight:600; color:#3a3a3a; }
tbody td{ border-bottom:.5pt solid #d9d9d4; }
tr{ break-inside:avoid; }
.group th{ padding:3mm 1.5mm 1mm; border-bottom:.8pt solid #121212; font-size:10pt; font-weight:700; break-after:avoid; }
.group span{ margin-left:1.5mm; font-weight:400; color:#6e6e6a; }
@media screen{ body{ max-width:277mm; margin:0 auto; padding:10mm 9mm; } }`;
}

/**
 * Слова не разрываем: иначе браузер сжимает колонку до пары букв. Исключения — телефон, он всегда
 * в одну строку, и почта: длинный адрес без пробелов иначе вытолкнул бы таблицу за край листа.
 */
function cellClass(column: ExportColumn) {
  if (column.fieldIds.includes("email")) return ' class="long"';
  return column.fieldIds.length === 1 && column.fieldIds[0] === "phone" ? ' class="nowrap"' : "";
}

function cell(value: string, column: ExportColumn) {
  return `<td${cellClass(column)}>${e(value) || "—"}</td>`;
}

function groupBody(group: CrewGroup, columns: ExportColumn[]) {
  const rows = group.rows
    .map((row) => `<tr>${columns.map((column) => cell(crewExportCell(row, column), column)).join("")}</tr>`)
    .join("");
  return `<tbody><tr class="group"><th colspan="${columns.length}" scope="rowgroup">${e(group.title)}<span>${group.rows.length}</span></th></tr>${rows}</tbody>`;
}

/**
 * Список команды для окна печати: группы по цехам, Medeo Sans встроен в страницу. Текст — через
 * `escapeHtml`, скриптов нет. Строки приходят из `toCrewRow`, колонки — из `crewExportColumns`.
 */
export function buildCrewPrintHtml(
  projectName: string,
  columns: ExportColumn[],
  groups: CrewGroup[],
): string {
  const printed = crewPrintColumns(columns);
  const headers = printed.map((column) => `<th scope="col">${e(resolveColumnHeader(column))}</th>`);
  return `<!DOCTYPE html><html lang="ru"><head>${PRINT_HTML_CSP_META}<meta charset="utf-8"/><title>Команда — ${e(projectName)}</title>
<style>${loadMedeoFontCss()}
${pageCss(printed.length)}</style></head><body>
<h1>Команда</h1>
<p class="project">${e(projectName)}</p>
<table><thead><tr>${headers.join("")}</tr></thead>${groups.map((group) => groupBody(group, printed)).join("")}</table>
</body></html>`;
}
