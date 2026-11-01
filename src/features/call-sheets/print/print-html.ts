import type {
  CallSheetPrintElementRow,
  CallSheetPrintModel,
} from "@/features/call-sheets/print/print-model";
import { escapeHtml, PRINT_HTML_CSP_META } from "@/shared/lib/escape-html";

/**
 * Печатный лист вызывного: модель → HTML-строка. Чистая функция, без скриптов и обработчиков;
 * весь текст — через `escapeHtml`, данные в `<style>` не попадают. Пустые поля и блоки не
 * выводятся, колонки таблиц без единого значения — тоже. Пока только лист 1 (сводка и списки);
 * план съёмки и схема объекта — следующие листы.
 */

const e = escapeHtml;

type Column<R> = {
  head: string;
  cell: (row: R, index: number) => string | null;
  /** Класс ячейки: `num` — номер, `time` — время (по центру, моноширинные цифры). */
  cls?: string;
  /** Показывать колонку, даже если в ней пусто. */
  always?: boolean;
};

function visibleColumns<R>(columns: Column<R>[], rows: R[]): Column<R>[] {
  return columns.filter((col) => col.always || rows.some((row, i) => Boolean(col.cell(row, i))));
}

function th<R>(col: Column<R>) {
  return `<th${col.cls ? ` class="${col.cls}"` : ""}>${e(col.head)}</th>`;
}

function td<R>(col: Column<R>, row: R, index: number) {
  return `<td${col.cls ? ` class="${col.cls}"` : ""}>${e(col.cell(row, index) ?? "")}</td>`;
}

function table<R>(columns: Column<R>[], rows: R[], cls = "grid") {
  if (rows.length === 0) return "";
  const cols = visibleColumns(columns, rows);
  return `<table class="${cls}"><thead><tr>${cols.map(th).join("")}</tr></thead><tbody>${rows
    .map((row, i) => `<tr>${cols.map((col) => td(col, row, i)).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function block(title: string, body: string, cls = "") {
  if (!body) return "";
  return `<section class="block${cls ? ` ${cls}` : ""}"><h2>${e(title)}</h2>${body}</section>`;
}

function summaryHtml(model: CallSheetPrintModel) {
  const dayLine = [model.shiftLabel, model.dayOfTotalLabel, model.nightShift ? "Ночная смена" : null]
    .filter(Boolean)
    .map((part) => e(part!))
    .join(" · ");

  const times = model.times.length
    ? `<table class="times${model.times.length < 5 ? " few" : ""}"><tr>${model.times
        .map((t) => `<th>${e(t.label)}</th>`)
        .join("")}</tr><tr>${model.times.map((t) => `<td>${e(t.value)}</td>`).join("")}</tr></table>`
    : "";

  const facts: [string, string][] = [];
  if (model.crewMeetAddress) facts.push(["Место сбора", e(model.crewMeetAddress)]);
  if (model.locations.length) {
    facts.push([
      model.locations.length > 1 ? "Объекты" : "Объект",
      model.locations
        .map(
          (loc, i) =>
            `<div class="loc">${model.locations.length > 1 ? `<span class="loc-n">${i + 1}</span>` : ""}<b>${e(loc.name)}</b>${loc.address ? ` — ${e(loc.address)}` : ""}</div>`,
        )
        .join(""),
    ]);
  }
  if (model.weather) {
    const w = model.weather;
    const parts = [
      w.summary ? e(w.summary) : null,
      w.tempDay ? `днём <b>${e(w.tempDay)}</b>` : null,
      w.tempNight ? `ночью <b>${e(w.tempNight)}</b>` : null,
      w.sunrise ? `восход <b>${e(w.sunrise)}</b>` : null,
      w.sunset ? `закат <b>${e(w.sunset)}</b>` : null,
    ].filter(Boolean);
    facts.push(["Погода", parts.join('<span class="sep"> · </span>')]);
  }
  const factsHtml = facts.length
    ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${e(k)}</dt><dd>${v}</dd>`).join("")}</dl>`
    : "";

  return `<header class="summary">
<div class="head">
  <div class="head-left"><div class="kind">Вызывной лист</div><h1>${e(model.projectName)}</h1></div>
  <div class="head-right"><div class="date">${e(model.dateLabel)}</div>${dayLine ? `<div class="dayline">${dayLine}</div>` : ""}</div>
</div>
${times ? `<div class="times-wrap">${times}</div>` : ""}${factsHtml}
</header>`;
}

function leadersHtml(model: CallSheetPrintModel) {
  const rows = model.leaders;
  if (rows.length === 0) return "";
  const columns: Column<(typeof rows)[number]>[] = [
    { head: "Должность", cell: (r) => r.position, always: true },
    { head: "Фамилия, имя", cell: (r) => r.name, cls: "strong person" },
    { head: "Телефон", cell: (r) => r.phone, cls: "phone" },
  ];
  // Больше 6 строк — две колонки рядом: так список занимает вдвое меньше высоты.
  if (rows.length <= 6) return table(columns, rows);
  const half = Math.ceil(rows.length / 2);
  const cols = visibleColumns(columns, rows);
  const part = (slice: typeof rows) =>
    `<table class="grid"><thead><tr>${cols.map(th).join("")}</tr></thead><tbody>${slice
      .map((row, i) => `<tr>${cols.map((col) => td(col, row, i)).join("")}</tr>`)
      .join("")}</tbody></table>`;
  return `<div class="pair">${part(rows.slice(0, half))}${part(rows.slice(half))}</div>`;
}

function crewHtml(model: CallSheetPrintModel) {
  if (model.crewCalls.length === 0) return "";
  return `<ul class="calls">${model.crewCalls
    .map((row) => `<li><span>${e(row.label)}</span><b>${e(row.time ?? "")}</b></li>`)
    .join("")}</ul>`;
}

function baseHtml(model: CallSheetPrintModel) {
  if (model.baseItems.length === 0) return "";
  return `<ul class="calls one">${model.baseItems
    .map(
      (row) =>
        `<li${row.notNeeded ? ' class="off"' : ""}><span>${e(row.name)}</span>${
          row.notNeeded ? "<i>не нужен</i>" : `<b>${e(row.time ?? "")}</b>`
        }</li>`,
    )
    .join("")}</ul>`;
}

function castHtml(model: CallSheetPrintModel) {
  return table(
    [
      { head: "№", cell: (_r, i) => String(i + 1), cls: "num", always: true },
      { head: "Персонаж", cell: (r) => r.character, cls: "strong", always: true },
      { head: "Актёр", cell: (r) => r.actor },
      { head: "Сцены", cell: (r) => r.scenes, cls: "scenes" },
      { head: "Транспорт", cell: (r) => r.transport },
      { head: "Прибытие", cell: (r) => r.arrival, cls: "time" },
      { head: "Грим", cell: (r) => r.makeup, cls: "time" },
      { head: "Костюм", cell: (r) => r.costume, cls: "time" },
      { head: "Готов", cell: (r) => r.ready, cls: "time" },
      { head: "Конец", cell: (r) => r.wrap, cls: "time" },
    ],
    model.cast,
  );
}

function elementsHtml(model: CallSheetPrintModel) {
  const sections = model.elementSections;
  if (sections.length === 0) return "";
  const columns: Column<CallSheetPrintElementRow>[] = [
    { head: "Что", cell: (r) => r.name, always: true },
    { head: "Кол-во", cell: (r) => r.quantity, cls: "qty" },
    { head: "Сцены", cell: (r) => r.scenes, cls: "scenes" },
    { head: "Прибытие", cell: (r) => r.arrival, cls: "time" },
    { head: "Готов", cell: (r) => r.ready, cls: "time" },
    { head: "Конец", cell: (r) => r.wrap, cls: "time" },
    { head: "Примечание", cell: (r) => r.notes },
  ];
  const cols = visibleColumns(
    columns,
    sections.flatMap((s) => s.rows),
  );
  const body = sections
    .map(
      (section) =>
        `<tbody><tr class="sec"><th colspan="${cols.length}">${e(section.name)}</th></tr>${section.rows
          .map(
            (row, i) =>
              `<tr>${cols
                .map((col, c) =>
                  c === 0 && row.secondUnit
                    ? `<td><span class="tag">2-й юнит</span> ${e(row.name)}</td>`
                    : td(col, row, i),
                )
                .join("")}</tr>`,
          )
          .join("")}</tbody>`,
    )
    .join("");
  return `<table class="grid elements"><thead><tr>${cols.map(th).join("")}</tr></thead>${body}</table>`;
}

function transportHtml(model: CallSheetPrintModel) {
  return table(
    [
      { head: "Техника", cell: (r) => r.name, cls: "strong", always: true },
      { head: "Подача", cell: (r) => r.callTime, cls: "time" },
      { head: "Конец", cell: (r) => r.wrapTime, cls: "time" },
      { head: "Сцены", cell: (r) => r.scenes, cls: "scenes" },
      { head: "Примечание", cell: (r) => r.notes },
    ],
    model.specialTransport,
  );
}

function scenesHtml(model: CallSheetPrintModel) {
  const rows = table(
    [
      { head: "Сцена", cell: (r) => r.number, cls: "strong nowrap", always: true },
      { head: "И/Н", cell: (r) => r.intExt, cls: "nowrap" },
      { head: "Режим", cell: (r) => r.dayNight, cls: "nowrap" },
      { head: "Объект", cell: (r) => r.location, cls: "loc-col" },
      { head: "Содержание", cell: (r) => r.summary, cls: "wide" },
      { head: "Персонажи", cell: (r) => r.characters },
      { head: "Стр.", cell: (r) => r.pages, cls: "time" },
      { head: "Хрон.", cell: (r) => r.timing, cls: "time" },
    ],
    model.scenes,
  );
  if (!rows) return "";
  const t = model.sceneTotals;
  const totals = [
    `сцен: ${t.count}`,
    t.pages ? `страниц: ${t.pages}` : null,
    t.timing ? `хронометраж: ${t.timing}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${rows}<p class="totals">Итого ${e(totals)}</p>`;
}

/**
 * Поля страницы: подвал «Вызывной лист · дата» и «Лист N из M» (Chrome 131+). В CSS идёт только
 * дата, собранная нами из даты дня, и то лишь буквы, цифры, пробел, точка и запятая — данные
 * пользователя в `<style>` не попадают.
 */
function pageCss(dateLabel: string) {
  const date = dateLabel.replace(/[^\p{L}\p{N} .,]/gu, "");
  return `@page { size: A4; margin: 9mm 9mm 11mm;
  @bottom-left { content: "Вызывной лист · ${date}"; font: 8pt "IBM Plex Sans", Arial, sans-serif; color: #000; }
  @bottom-right { content: "Лист " counter(page) " из " counter(pages); font: 8pt "IBM Plex Sans", Arial, sans-serif; color: #000; }
}`;
}

const SHEET_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { font-family: "IBM Plex Sans", Arial, sans-serif; font-size: 8.5pt; line-height: 1.22;
  font-variant-numeric: tabular-nums; }
.sheet { width: 210mm; margin: 0 auto; padding: 9mm 9mm 11mm; }
@media print { .sheet { width: auto; padding: 0; } }
b, strong, .strong { font-weight: 600; }
h1, h2, p, ul, dl, dd { margin: 0; padding: 0; }

/* Сводка дня — в рамке 2pt */
.summary { border: 2pt solid #000; break-inside: avoid; }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm; padding: 2.2mm 3mm 2mm; }
.kind { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; }
h1 { font-size: 17pt; font-weight: 700; line-height: 1.1; }
.head-right { text-align: right; }
.date { font-size: 12pt; font-weight: 700; }
.dayline { font-size: 10pt; font-weight: 600; margin-top: .6mm; }
.times-wrap { border-top: 2pt solid #000; }
.times { width: 100%; border-collapse: collapse; }
.times.few { width: auto; }
.times.few th, .times.few td { min-width: 30mm; }
.times.few th:last-child, .times.few td:last-child { border-right: 1pt solid #000; }
.times th, .times td { text-align: center; border-left: 1pt solid #000; white-space: nowrap; }
.times th:first-child, .times td:first-child { border-left: 0; }
.times th { font-size: 8pt; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; padding: 1mm 2mm 0; }
.times td { font-size: 15pt; font-weight: 700; line-height: 1.15; padding: 0 2mm 1.2mm; }
.facts { display: grid; grid-template-columns: 24mm 1fr; border-top: 2pt solid #000; padding: 1.4mm 3mm 1.6mm; row-gap: 1mm; }
.facts dt { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding-top: .3mm; }
.facts dd { font-size: 9pt; }
.loc { padding-left: 4.5mm; position: relative; }
.loc + .loc { margin-top: .4mm; }
.loc-n { position: absolute; left: 0; font-weight: 700; }
.sep { color: #000; }

/* Блоки: толстая линия сверху и заголовок прописными */
.block { margin-top: 3.2mm; }
.block > h2 { font-size: 9.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
  border-top: 2.5pt solid #000; padding-top: .9mm; margin-bottom: 1.2mm; break-after: avoid; }
.text { font-size: 9pt; white-space: pre-line; overflow-wrap: anywhere; }
.important { border: 2pt solid #000; padding: 1.6mm 3mm 2mm; break-inside: avoid; }
.important > h2 { border-top: 0; padding-top: 0; font-size: 11pt; }
.important .text { font-size: 9.5pt; font-weight: 600; }
.short { break-inside: avoid; }

.row { display: flex; gap: 6mm; align-items: flex-start; }
.row > .block { flex: 1 1 0; min-width: 0; }
.row > .block.narrow { flex: 0 0 62mm; }
.pair { display: flex; gap: 6mm; align-items: flex-start; }
.pair > table { flex: 1 1 0; min-width: 0; }

table.grid { width: 100%; border-collapse: collapse; }
.grid thead { display: table-header-group; }
.grid tr { break-inside: avoid; }
.grid th { font-size: 8pt; font-weight: 600; text-align: left; text-transform: uppercase; letter-spacing: .04em;
  border-bottom: 1pt solid #000; padding: 0 1.4mm .6mm; white-space: nowrap; }
.grid td { border-bottom: .5pt solid #777; padding: .5mm 1.4mm; vertical-align: top; overflow-wrap: anywhere; }
.grid th:first-child, .grid td:first-child { padding-left: 0; }
.grid td.time, .grid th.time, .grid td.qty, .grid th.qty { text-align: center; white-space: nowrap; }
.grid td.time { font-weight: 600; }
.grid td.num, .grid th.num { width: 5mm; text-align: right; padding-right: 1.6mm; }
.grid td.phone, .grid td.person, .grid td.nowrap { white-space: nowrap; }
.grid td.scenes { overflow-wrap: normal; }
.grid td.wide { width: 34%; }
.grid td.loc-col { min-width: 28mm; }
.elements td:first-child { width: 40%; }
.elements tr.sec th { font-size: 8.5pt; font-weight: 700; text-transform: none; letter-spacing: 0;
  border-bottom: 1pt solid #000; padding: 1.1mm 0 .3mm; }
.elements tbody:first-of-type tr.sec th { padding-top: .6mm; }
.elements tr.sec { break-after: avoid; }
.tag { display: inline-block; white-space: nowrap; border: .75pt solid #000; font-size: 8pt; font-weight: 600; padding: 0 .8mm; line-height: 1.2; }

ul.calls { list-style: none; column-count: 2; column-gap: 6mm; }
ul.calls.one { column-count: 1; }
.calls li { display: flex; justify-content: space-between; gap: 2mm; border-bottom: .5pt solid #777; padding: .5mm 0; break-inside: avoid; }
.calls li b { white-space: nowrap; font-weight: 700; }
.calls li i { font-style: italic; white-space: nowrap; }
.calls li.off span { text-decoration: line-through; }
.totals { margin-top: 1mm; font-weight: 600; }
`;

export type CallSheetHtmlOptions = {
  /** `@font-face` со встроенным шрифтом (`loadPlexFontCss`); пусто — системный шрифт. */
  fontCss?: string;
};

/** Лист 1 вызывного: сводка дня, тексты, люди, элементы, спецтранспорт, сцены. */
export function buildCallSheetHtml(
  model: CallSheetPrintModel,
  options: CallSheetHtmlOptions = {},
): string {
  const crew = block("Вызов цехов", crewHtml(model), "short");
  const base = block("База и транспорт", baseHtml(model), "short narrow");
  const crewRow = crew && base ? `<div class="row">${crew}${base}</div>` : crew || base;

  const body = [
    summaryHtml(model),
    block(
      "Важно",
      model.important ? `<div class="text">${e(model.important)}</div>` : "",
      "important",
    ),
    block(
      "Ограничения по актёрам",
      model.actorRestrictions ? `<div class="text">${e(model.actorRestrictions)}</div>` : "",
      "short",
    ),
    block("Руководители", leadersHtml(model)),
    crewRow,
    block("Актёры", castHtml(model)),
    block("Элементы площадки", elementsHtml(model)),
    block("Спецтранспорт", transportHtml(model), "short"),
    block("Сцены дня", scenesHtml(model)),
  ]
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ru">
<head>${PRINT_HTML_CSP_META}
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${e(model.documentTitle)}</title>
<style>
${options.fontCss ?? ""}
${pageCss(model.dateLabel)}
${SHEET_CSS}
</style>
</head>
<body><main class="sheet">
${body}
</main></body>
</html>`;
}
