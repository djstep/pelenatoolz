import type {
  CallSheetPrintCastRow,
  CallSheetPrintElementRow,
  CallSheetPrintModel,
  CallSheetPrintPlanRow,
} from "@/features/call-sheets/print/print-model";
import { escapeHtml, PRINT_HTML_CSP_META } from "@/shared/lib/escape-html";

/**
 * Печатный лист вызывного: модель → HTML-строка. Чистая функция, без скриптов и обработчиков;
 * весь текст — через `escapeHtml`, строки в CSS `content` — через `cssString`. Вид — по макету
 * владельца (`docs/callsheet-mockup-v5.html`). Страницы — поток: принудительный разрыв только
 * перед схемой объекта; бегущая шапка листов 2+ и подвал — поля страницы (`@page`).
 * Пустые поля и блоки не выводятся, колонки таблиц без единого значения — тоже.
 */

const e = escapeHtml;

/** Управляющие символы и разделители строк U+2028 / U+2029. */
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f, 0x2028, 0x2029)}]+`,
  "g",
);

/**
 * Строка для CSS `content: "…"`: обратная косая и кавычка экранируются, переводы строк и
 * прочие управляющие символы — пробел, «<» — `\3C ` (так в `<style>` не закрыть тег).
 */
export function cssString(value: string): string {
  const body = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(CONTROL_CHARS, " ")
    .replace(/</g, "\\3C ");
  return `"${body}"`;
}

/** Время — моноширинными цифрами, без переноса. */
function t(value: string) {
  return `<span class="t">${e(value)}</span>`;
}

/** Время или бледный прочерк. */
function tOrDash(value: string | null) {
  return value ? t(value) : `<span class="none">—</span>`;
}

const U2_TAG = `<span class="u2tag">2-й юнит</span>`;

function blockHead(title: string, extra = "", cls = "") {
  return `<div class="bh${cls ? ` ${cls}` : ""}"><h2>${e(title)}</h2>${extra}</div>`;
}

function count(n: number) {
  return `<span class="cnt">${n}</span>`;
}

function sceneWord(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "сцена";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "сцены";
  return "сцен";
}

// ---- Шапка, времена, сведения ----

function headHtml(model: CallSheetPrintModel) {
  const meta = [
    model.shiftNumber ? `<b>Смена №${model.shiftNumber}</b>` : null,
    model.nightShift ? "ночная смена" : null,
    model.dayOfTotalLabel ? e(model.dayOfTotalLabel) : null,
    model.totals.sceneCount
      ? `${model.totals.sceneCount}&nbsp;${sceneWord(model.totals.sceneCount)}`
      : null,
    model.totals.dayTiming ? `хронометраж дня ${t(model.totals.dayTiming)}` : null,
  ].filter(Boolean);

  const { crewCall } = model;
  const dark = crewCall.time
    ? `<div class="dark"><span class="lbl">Сбор группы</span>${t(crewCall.time)}</div>`
    : "";
  const place = crewCall.address
    ? `<div class="place"><span class="lbl">Место сбора</span><b>${e(crewCall.address)}</b>${
        model.scheme ? `<span class="mute">схема — в конце</span>` : ""
      }</div>`
    : "";

  return `<div class="head">
  <div>
    <div class="kicker">Вызывной лист</div>
    <h1>${e(model.projectName)}</h1>
    <div class="date">${e(model.dateLabel)}</div>
    ${meta.length ? `<div class="meta">${meta.join(" · ")}</div>` : ""}
  </div>
  ${dark || place ? `<div class="callbox">${dark}${place}</div>` : ""}
</div>`;
}

function timesHtml(model: CallSheetPrintModel) {
  if (model.times.length === 0) return "";
  return `<div class="times">${model.times
    .map(
      (time) =>
        `<div${time.accent ? ` class="hot"` : ""}><span class="lbl">${e(time.label)}</span>${t(time.value)}</div>`,
    )
    .join("")}</div>`;
}

function infoHtml(model: CallSheetPrintModel) {
  const cols: string[] = [];
  const w = model.weather;
  if (w) {
    const kv = (
      [
        ["днём", w.tempDay],
        ["ночью", w.tempNight],
        ["восход", w.sunrise],
        ["закат", w.sunset],
      ] as const
    )
      .filter(([, value]) => value)
      .map(([label, value]) => `<span>${label}</span>${t(value!)}`)
      .join("");
    cols.push(
      `<div class="w"><div class="lbl">Погода</div>${
        w.summary ? `<div class="wsum">${e(w.summary)}</div>` : ""
      }${kv ? `<div class="kv">${kv}</div>` : ""}</div>`,
    );
  }
  if (model.locations.length) {
    const several = model.locations.length > 1 || model.locations[0]!.rows.length > 1;
    const objects = model.locations
      .map(
        (group) =>
          `<div class="obj">${group.address ? `<div class="addr">${e(group.address)}</div>` : ""}${group.rows
            .map(
              (row) =>
                `<span>${e(row.name)}</span><span>${row.secondUnit ? U2_TAG : row.scenes ? t(row.scenes) : ""}</span>`,
            )
            .join("")}</div>`,
      )
      .join("");
    cols.push(`<div class="o"><div class="lbl">${several ? "Объекты" : "Объект"}</div>${objects}</div>`);
  }
  if (model.actorRestrictions) {
    cols.push(
      `<div class="r"><div class="lbl">Ограничения по актёрам</div><div class="pre">${e(model.actorRestrictions)}</div></div>`,
    );
  }
  return cols.length ? `<div class="info">${cols.join("")}</div>` : "";
}

function importantHtml(model: CallSheetPrintModel) {
  if (!model.important) return "";
  return `<div class="important"><span class="lbl">Важно</span><p>${e(model.important)}</p></div>`;
}

// ---- Руководители, цеха, база ----

/** «Миронова Татьяна» → фамилия жирным. */
function boldLastName(name: string) {
  const [last, ...rest] = name.split(/\s+/);
  return `<b>${e(last!)}</b>${rest.length ? ` ${e(rest.join(" "))}` : ""}`;
}

function leadersHtml(model: CallSheetPrintModel) {
  const rows = model.leaders;
  if (rows.length === 0) return "";
  const withName = rows.some((r) => r.name);
  const withPhone = rows.some((r) => r.phone);
  const head = `<tr><th>Должность</th>${withName ? "<th>Фамилия имя</th>" : ""}${
    withPhone ? `<th class="r">Телефон</th>` : ""
  }</tr>`;
  const body = rows
    .map(
      (r) =>
        `<tr><td>${e(r.position)}</td>${withName ? `<td class="nm">${r.name ? boldLastName(r.name) : ""}</td>` : ""}${
          withPhone ? `<td class="r">${r.phone ? t(r.phone) : ""}</td>` : ""
        }</tr>`,
    )
    .join("");
  return `<div>${blockHead("Руководители группы", count(rows.length))}<table class="z lead"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function crewHtml(model: CallSheetPrintModel) {
  const rows = model.crewCalls;
  if (rows.length === 0) return "";
  const withTime = rows.some((r) => r.time);
  const body = rows
    .map((r) => {
      const cls = [r.earliest ? "early" : "", r.newTime ? "newt" : ""].filter(Boolean).join(" ");
      return `<tr${cls ? ` class="${cls}"` : ""}><td>${e(r.label)}</td>${
        withTime ? `<td class="r">${r.time ? t(r.time) : ""}</td>` : ""
      }</tr>`;
    })
    .join("");
  return `<div>${blockHead("Вызов цехов", count(rows.length))}<table class="crew"><thead><tr><th>Цех</th>${
    withTime ? `<th class="r">Вызов</th>` : ""
  }</tr></thead><tbody>${body}</tbody></table></div>`;
}

function leadersCrewHtml(model: CallSheetPrintModel) {
  const leaders = leadersHtml(model);
  const crew = crewHtml(model);
  if (!leaders && !crew) return "";
  if (!leaders || !crew) return `<div class="block">${leaders || crew}</div>`;
  return `<div class="two block">${leaders}${crew}</div>`;
}

function baseHtml(model: CallSheetPrintModel) {
  const rows = model.baseItems;
  if (rows.length === 0) return "";
  const cellsHtml = rows
    .map((r) =>
      r.notNeeded
        ? `<div class="off"><span>${e(r.name)}</span><span class="t">не нужен</span></div>`
        : `<div><span>${e(r.name)}</span>${r.time ? t(r.time) : ""}</div>`,
    )
    .join("");
  const timed = rows.some((r) => r.time);
  return `<div class="block">${blockHead(
    "База и транспорт группы",
    timed ? `<span class="sub">время прибытия на базу</span>` : "",
  )}<div class="base">${cellsHtml}</div></div>`;
}

// ---- Таблицы со скрытием пустых колонок ----

type Column<R> = {
  head: string;
  /** Есть ли значение (пустая во всех строках колонка не выводится). */
  has: (row: R) => boolean;
  cell: (row: R) => string;
  cls?: string;
};

function columnsFor<R>(columns: Column<R>[], rows: R[]) {
  return columns.filter((col) => rows.some(col.has));
}

function headCells<R>(cols: Column<R>[]) {
  return cols.map((col) => `<th${col.cls ? ` class="${col.cls}"` : ""}>${e(col.head)}</th>`).join("");
}

function rowCells<R>(cols: Column<R>[], row: R) {
  return cols.map((col) => `<td${col.cls ? ` class="${col.cls}"` : ""}>${col.cell(row)}</td>`).join("");
}

function simpleTable<R>(cls: string, columns: Column<R>[], rows: R[]) {
  const cols = columnsFor(columns, rows);
  return `<table class="${cls}"><thead><tr>${headCells(cols)}</tr></thead><tbody>${rows
    .map((r) => `<tr>${rowCells(cols, r)}</tr>`)
    .join("")}</tbody></table>`;
}

// ---- Актёры, групповка, элементы ----

function transportCell(row: CallSheetPrintCastRow) {
  const tr = row.transport;
  if (!tr) return "";
  if (tr.kind === "custom") return e(tr.text);
  return `<span class="chip ${tr.kind}">${e(tr.text)}</span>`;
}

function castHtml(model: CallSheetPrintModel) {
  const rows = model.cast;
  if (rows.length === 0) return "";
  const time = (
    head: string,
    get: (r: CallSheetPrintCastRow) => string | null,
    cls = "r",
  ): Column<CallSheetPrintCastRow> => ({
    head,
    has: (r) => Boolean(get(r)),
    cell: (r) => tOrDash(get(r)),
    cls,
  });
  const columns: Column<CallSheetPrintCastRow>[] = [
    {
      head: "Персонаж / актёр",
      has: () => true,
      cls: "who",
      cell: (r) => `<b>${e(r.character)}</b>${r.actor ? `<span>${e(r.actor)}</span>` : ""}`,
    },
    { head: "Сцены", has: (r) => Boolean(r.scenes), cell: (r) => t(r.scenes) },
    { head: "Транспорт", has: (r) => Boolean(r.transport), cell: transportCell },
    time("Подача машины", (r) => r.carPickup, "r pick"),
    time("Прибытие", (r) => r.arrival),
    time("Костюм", (r) => r.costume),
    time("Грим", (r) => r.makeup),
    time("Готов", (r) => r.ready, "r ready"),
    time("Конец", (r) => r.wrap),
  ];
  return `<div class="block">${blockHead("Актёры", count(rows.length))}${simpleTable("actors", columns, rows)}</div>`;
}

function elementName(row: CallSheetPrintElementRow, withQuantity: boolean) {
  const q = row.quantity;
  const name =
    withQuantity && q && q !== "1"
      ? /^\d+$/.test(q)
        ? `${row.name}, ${q} шт`
        : `${row.name}, ${q}`
      : row.name;
  return `${e(name)}${row.secondUnit ? ` ${U2_TAG}` : ""}${
    row.notes ? `<div class="enote">${e(row.notes)}</div>` : ""
  }`;
}

function rowTimeColumns(): Column<CallSheetPrintElementRow>[] {
  return [
    { head: "Сцены", has: (r) => Boolean(r.scenes), cell: (r) => (r.scenes ? t(r.scenes) : tOrDash(null)) },
    { head: "Прибытие", has: (r) => Boolean(r.arrival), cls: "r", cell: (r) => tOrDash(r.arrival) },
    { head: "Готов", has: (r) => Boolean(r.ready), cls: "r", cell: (r) => tOrDash(r.ready) },
    { head: "Конец", has: (r) => Boolean(r.wrap), cls: "r end", cell: (r) => tOrDash(r.wrap) },
  ];
}

function groupsHtml(model: CallSheetPrintModel) {
  const rows = model.groups;
  if (rows.length === 0) return "";
  const columns: Column<CallSheetPrintElementRow>[] = [
    { head: "Кто", has: () => true, cell: (r) => elementName(r, false) },
    {
      head: "Чел.",
      has: (r) => Boolean(r.quantity),
      cls: "c",
      cell: (r) => (r.quantity ? `<b>${e(r.quantity)}</b>` : ""),
    },
    ...rowTimeColumns(),
  ];
  return `<div class="block">${blockHead("Групповка и дублёры", count(rows.length))}${simpleTable("grp z", columns, rows)}</div>`;
}

function elementsHtml(model: CallSheetPrintModel) {
  const sections = model.elementSections;
  if (sections.length === 0) return "";
  const all = sections.flatMap((s) => s.rows);
  const cols = columnsFor(
    [{ head: "Что", has: () => true, cell: (r) => elementName(r, true) }, ...rowTimeColumns()],
    all,
  );
  // Раздел — объединённой ячейкой на все его строки, разделы — линией.
  const body = sections
    .map((section) =>
      section.rows
        .map((row, i) => {
          const sec =
            i === 0
              ? `<td class="secname"${section.rows.length > 1 ? ` rowspan="${section.rows.length}"` : ""}>${e(section.name)}</td>`
              : "";
          return `<tr${i === 0 ? ` class="sec"` : ""}>${sec}${rowCells(cols, row)}</tr>`;
        })
        .join(""),
    )
    .join("");
  return `<div class="block">${blockHead("Элементы площадки", count(all.length))}<table class="el"><thead><tr><th>Раздел</th>${headCells(cols)}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---- План ----

function planTime(row: CallSheetPrintPlanRow) {
  return `<td class="time">${row.time ? t(row.time) : ""}${
    row.duration ? `<span class="dur">${e(row.duration)}</span>` : ""
  }</td>`;
}

function planRowHtml(row: CallSheetPrintPlanRow) {
  if (row.kind === "service") {
    return `<tr class="svc${row.lunch ? " lunch" : ""}">${planTime(row)}<td></td><td${row.lunch ? ` class="what"` : ""}>${e(row.label)}${
      row.note ? `<span class="snote"> · ${e(row.note)}</span>` : ""
    }</td><td></td><td></td></tr>`;
  }
  const cls = [row.tone ?? "", row.continuation ? "cont" : ""].filter(Boolean).join(" ");
  const chip = row.intExtLabel && row.tone ? `<span class="ie ${row.tone}">${e(row.intExtLabel)}</span>` : "";
  const slug =
    chip || row.title || row.mode
      ? `<div class="slug">${chip}${row.title ? e(row.title) : ""}${
          row.mode ? ` <span class="mode">· ${e(row.mode)}</span>` : ""
        }</div>`
      : "";
  const elist = row.elements.length
    ? `<div class="elist">${row.elements
        .map((el) => `<span class="k">${e(el.label)}</span><span>${e(el.value)}</span>`)
        .join("")}</div>`
    : "";
  const content = `${slug}${row.synopsis ? `<div class="syn">${e(row.synopsis)}</div>` : ""}${elist}${
    row.note ? `<div class="pnote">${e(row.note)}</div>` : ""
  }`;
  const dash = row.continuation ? "" : `<span class="none">—</span>`;
  return `<tr${cls ? ` class="${cls}"` : ""}>${planTime(row)}<td class="scn">${
    row.sceneNumber ? e(row.sceneNumber) : `<span class="none nodash">—</span>`
  }</td><td>${content}</td><td class="pers">${row.characters ? e(row.characters) : dash}</td><td class="chr r">${
    row.timing ? t(row.timing) : dash
  }</td></tr>`;
}

const PLAN_HEAD = `<thead><tr><th>Время</th><th>Сцена</th><th>Объект · содержание · элементы</th><th>Персонажи</th><th class="r">Хрон.</th></tr></thead>`;

function planHtml(model: CallSheetPrintModel) {
  if (model.plan.length === 0) return "";
  const total = model.totals.mainTiming
    ? `<tr class="total"><td colspan="4" class="r">Итого хронометраж основного юнита</td><td class="r">${t(model.totals.mainTiming)}</td></tr>`
    : "";
  return `<div class="block">${blockHead("План съёмки · основной юнит")}<table class="plan">${PLAN_HEAD}<tbody>${model.plan
    .map(planRowHtml)
    .join("")}${total}</tbody></table></div>`;
}

function secondUnitHtml(model: CallSheetPrintModel) {
  const { rows, range } = model.secondUnit;
  if (rows.length === 0) return "";
  return `<div class="block">${blockHead(
    "Второй юнит",
    range ? `<span class="sub t">${e(range)}</span>` : "",
    "u2h",
  )}<table class="plan u2">${PLAN_HEAD}<tbody>${rows.map(planRowHtml).join("")}</tbody></table></div>`;
}

// ---- Схема объекта ----

function schemeHtml(model: CallSheetPrintModel) {
  const s = model.scheme;
  if (!s) return "";
  const points = s.points
    .map(
      (p, i) =>
        `<div class="pt"><span class="n${i === 0 ? " acc" : ""}">${e(p.number)}</span><div><b>${e(p.name)}</b>${
          p.description ? `<span>${e(p.description)}</span>` : ""
        }</div></div>`,
    )
    .join("");
  const texts = (
    [
      ["Как добраться", s.directions],
      ["Парковка", s.parking],
      ["На месте", s.onSite],
    ] as const
  )
    .filter(([, value]) => value)
    .map(([label, value]) => `<div class="lbl">${label}</div><p>${e(value!)}</p>`)
    .join("");
  const sub = [s.title, s.address]
    .filter(Boolean)
    .map((part) => e(part!))
    .join(" · ");
  return `<div class="scheme-page"><div class="block schemeblk">${blockHead(
    "Схема объекта",
    sub ? `<span class="sub">${sub}</span>` : "",
  )}<div class="map"><div class="mapcap">Карта объекта: сюда встанет картинка, прикреплённая к объекту.</div><div class="north">север ↑</div></div><div class="scheme"><div>${points}</div>${
    texts ? `<div class="txt">${texts}</div>` : ""
  }</div></div></div>`;
}

// ---- Страница ----

function pageCss(model: CallSheetPrintModel) {
  const shift = model.shiftNumber ? `смена ${model.shiftNumber}` : null;
  const scenes = model.totals.sceneCount
    ? `${model.totals.sceneCount} ${sceneWord(model.totals.sceneCount)}`
    : null;
  const timeOf = (label: string) => model.times.find((time) => time.label === label)?.value;
  const motor = timeOf("Мотор");
  const stop = timeOf("Стоп-мотор");
  const meet = model.crewCall.time ? `сбор ${model.crewCall.time}` : null;
  const runLeft = [model.projectName, model.shortDateLabel, shift].filter(Boolean).join(" · ");
  const runRight = [
    meet,
    motor ? `мотор ${motor}` : null,
    stop ? `стоп ${stop}` : null,
    scenes,
    model.totals.dayTiming ? `хрон. ${model.totals.dayTiming}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const schemeRight = [meet, model.scheme?.address ?? model.crewCall.address]
    .filter(Boolean)
    .join(" · ");
  const footLeft = [model.projectName, `вызывной на ${model.numericDate}`, shift]
    .filter(Boolean)
    .join(" · ");
  const rule = `vertical-align:bottom; border-bottom:2.4pt solid #121212;`;
  const font = `"Medeo Sans",Arial,sans-serif`;
  return `@page{ size:A4; margin:17mm 9mm 12mm;
  @top-left{ content:${cssString(runLeft)}; font:700 10pt ${font}; color:#121212; padding-bottom:1.4mm; ${rule} white-space:nowrap; }
  @top-center{ content:""; ${rule} }
  @top-right{ content:${cssString(runRight)}; font:600 7.4pt ${font}; color:#3a3a3a; padding-bottom:1.7mm; text-align:right; ${rule} }
  @bottom-left{ content:${cssString(footLeft)}; font:7pt ${font}; color:#6e6e6a; }
  @bottom-right{ content:"лист " counter(page) " из " counter(pages); font:7pt ${font}; color:#6e6e6a; text-align:right; }
}
@page :first{ margin-top:9mm;
  @top-left{ content:none; border:0; } @top-center{ content:none; border:0; } @top-right{ content:none; border:0; }
}
@page scheme{
  @top-right{ content:${cssString(schemeRight)}; }
}`;
}

const SHEET_CSS = `
:root{
  color-scheme:light;
  --ink:#121212; --ink2:#3a3a3a; --mute:#6e6e6a; --faint:#a3a39e;
  --line:#d9d9d4; --line2:#bdbdb7; --zebra:#f4f4f1; --svc:#efefeb;
  --acc:#d24a0c; --acc-bg:#fdf1ea; --acc-line:#f0b896;
  --int:#2c5ea8; --int-bg:#e8eef8; --nat:#1d7a4c; --nat-bg:#e4f2ea;
  --u2:#6b3fa0; --u2-bg:#f0eaf7; --note:#fbf5df; --note-line:#e7d79b;
}
*{ box-sizing:border-box; font-style:normal; }
html,body{ margin:0; background:#fff; }
body{ font:8pt/1.28 "Medeo Sans",Arial,sans-serif; color:var(--ink); -webkit-print-color-adjust:exact; print-color-adjust:exact; font-variant-numeric:tabular-nums; }
h1,h2,p{ margin:0; }
.t{ font-weight:600; white-space:nowrap; font-variant-numeric:tabular-nums; letter-spacing:.01em; }
.mute{ color:var(--mute); }
.none{ color:var(--faint); font-weight:400; }
.pre{ white-space:pre-line; }
.lbl{ font-size:6.5pt; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--mute); }
.sheet{ margin:0 auto; }
@media screen{
  body{ background:#e8e8e4; padding:12px 0; }
  .sheet{ background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.15); padding:9mm; width:210mm; }
  .scheme-page{ margin-top:10mm; padding-top:6mm; border-top:1px dashed var(--line2); }
}

/* шапка */
.head{ display:grid; grid-template-columns:1fr auto; gap:6mm; align-items:start; padding-bottom:3mm; break-inside:avoid; }
.head .kicker{ font-size:7pt; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--mute); }
.head h1{ font-size:26pt; line-height:1; margin:1.2mm 0 1mm; font-weight:700; letter-spacing:-.01em; }
.head .date{ font-size:11pt; font-weight:600; }
.head .meta{ margin-top:1mm; color:var(--ink2); }
.head .meta b{ font-weight:700; }
.callbox{ display:flex; border:1.6pt solid var(--ink); }
.callbox .dark{ background:#141414; color:#fff; padding:2.2mm 4mm 2mm; }
.callbox .dark .lbl{ color:#f6a06d; display:block; }
.callbox .dark .t{ font-weight:700; font-size:28pt; line-height:1; color:#ff7a33; display:block; margin-top:1mm; letter-spacing:-.02em; }
.callbox .place{ padding:2.2mm 4mm; max-width:52mm; }
.callbox .place .lbl, .callbox .place .mute{ display:block; }
.callbox .place b{ display:block; font-size:9pt; margin-top:1.2mm; }

.times{ display:flex; border-top:2.4pt solid var(--ink); border-bottom:1pt solid var(--ink); break-inside:avoid; }
.times > div{ flex:1 1 0; padding:1.4mm 2.5mm 1.6mm; border-right:.6pt solid var(--line2); }
.times > div:last-child{ border-right:0; }
.times .lbl{ display:block; }
.times .t{ font-weight:700; font-size:13pt; display:block; margin-top:.4mm; }
.times .hot .t{ color:var(--acc); }

.info{ display:flex; gap:5mm; padding:2.4mm 0 2.6mm; border-bottom:.6pt solid var(--line2); break-inside:avoid; }
.info > div{ min-width:0; }
.info .w{ flex:1.25 1 0; } .info .o{ flex:1.45 1 0; } .info .r{ flex:.8 1 0; }
.info .lbl{ margin-bottom:1mm; }
.wsum{ margin-bottom:.8mm; }
.kv{ display:grid; grid-template-columns:repeat(2, auto max-content); justify-content:start; column-gap:2.5mm; row-gap:.2mm; }
.kv span:nth-child(4n+3){ margin-left:5mm; }
.kv span:nth-child(odd){ color:var(--mute); }
.obj{ display:grid; grid-template-columns:1fr auto; column-gap:3mm; row-gap:.3mm; }
.obj + .obj{ margin-top:1mm; }
.obj .addr{ grid-column:1/-1; font-weight:700; margin-bottom:.4mm; }
.u2tag{ display:inline-block; font-size:6.5pt; font-weight:700; letter-spacing:.04em; color:var(--u2); background:var(--u2-bg); padding:0 1.3mm; border-radius:1mm; text-transform:uppercase; white-space:nowrap; }

.important{ display:flex; gap:3mm; align-items:baseline; margin:2.4mm 0 0; padding:1.8mm 3mm; background:var(--acc-bg); border-left:3pt solid var(--acc); break-inside:avoid; }
.important .lbl{ color:var(--acc); font-size:7pt; }
.important p{ margin:0; font-weight:600; font-size:8.6pt; white-space:pre-line; }

/* блоки */
.block{ margin-top:4mm; }
.bh{ position:relative; display:flex; align-items:center; gap:2mm; border-bottom:1.6pt solid var(--ink); padding-bottom:.8mm; break-after:avoid; break-inside:avoid; }
.bh h2{ display:inline-flex; align-items:center; gap:1.8mm; margin:0; font-size:9pt; font-weight:700; letter-spacing:.05em; text-transform:uppercase; background:var(--acc-bg); padding:.5mm 2.2mm .5mm 0; }
.bh h2::before{ content:""; width:2.4mm; align-self:stretch; background:var(--acc); }
.bh::after{ content:""; position:absolute; left:0; bottom:-1.6pt; width:22mm; height:1.6pt; background:var(--acc); }
.bh .cnt{ font-size:7pt; font-weight:600; color:#fff; background:var(--ink); border-radius:1mm; padding:0 1.2mm; }
.bh .sub{ font-size:7pt; color:var(--mute); }

table{ width:100%; border-collapse:collapse; }
thead{ display:table-header-group; }
th{ text-align:left; font-size:6.3pt; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--mute); padding:1mm 1.5mm .8mm; border-bottom:.6pt solid var(--line2); white-space:nowrap; }
td{ padding:.75mm 1.5mm; border-bottom:.5pt solid var(--line); vertical-align:top; }
tr{ break-inside:avoid; }
table.z td, .crew td{ padding-top:.5mm; padding-bottom:.5mm; line-height:1.2; }
table.z tbody tr:nth-child(even) td{ background:var(--zebra); }
td.r, th.r{ text-align:right; }
td.c, th.c{ text-align:center; }
td:first-child, th:first-child{ padding-left:1mm; }
.lead td.nm{ white-space:nowrap; }

.two{ display:grid; grid-template-columns:1.32fr 1fr; gap:5mm; align-items:start; }

/* вызов цехов */
.crew tr.newt td{ border-top:.9pt solid var(--ink2); }
.crew td .t{ font-size:8pt; }
.crew tr.early td .t{ color:var(--acc); }
.crew tbody tr:nth-child(even) td{ background:var(--zebra); }

/* база */
.base{ display:grid; grid-template-columns:repeat(4,1fr); column-gap:4mm; margin-top:.4mm; }
.base > div{ display:flex; justify-content:space-between; gap:2mm; padding:.8mm 1mm; border-bottom:.5pt solid var(--line); break-inside:avoid; }
.base > div:nth-child(8n+5), .base > div:nth-child(8n+6), .base > div:nth-child(8n+7), .base > div:nth-child(8n+8){ background:var(--zebra); }
.base .off{ color:var(--faint); }
.base .off .t{ font-weight:400; }

/* актёры */
.actors td.who b{ display:block; font-size:8.6pt; letter-spacing:.02em; text-transform:uppercase; }
.actors td.who span{ display:block; font-size:8.6pt; color:var(--ink); margin-top:.2mm; }
.actors td{ padding-top:.8mm; padding-bottom:.8mm; }
.actors td .t{ font-weight:500; }
.actors td.pick .t{ font-weight:700; }
.actors td.ready{ background:#f1f1ee; }
.actors td.ready .t{ color:var(--ink); font-weight:700; }
.actors th.ready{ color:var(--ink); }
.chip{ display:inline-block; font-size:6.8pt; font-weight:600; padding:.1mm 1.4mm; border-radius:1mm; white-space:nowrap; }
.chip.car{ background:#141414; color:#fff; }
.chip.self{ border:.6pt solid var(--line2); color:var(--ink2); }

/* групповка и элементы */
.el td{ padding-top:.65mm; padding-bottom:.65mm; }
.el tr.sec td{ border-top:.9pt solid var(--ink2); }
.el tbody tr.sec:first-child td{ border-top:0; }
.el td.secname{ font-size:6.6pt; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--ink2); width:26mm; padding-top:1mm; }
.el td .t, .grp td .t{ font-weight:500; }
.el td.end .t, .grp td.end .t{ font-weight:600; }
.enote{ font-size:7.4pt; color:var(--mute); }

/* план */
.plan th{ border-bottom:1.2pt solid var(--ink); }
.plan td{ border-bottom:.5pt solid var(--line2); padding-top:1mm; padding-bottom:1mm; }
.plan td.time{ width:17mm; border-left:3pt solid transparent; }
.plan td.time .t{ font-size:8.6pt; font-weight:700; display:block; }
.plan td.time .dur{ font-size:7.4pt; color:var(--mute); }
.plan td.scn{ width:11mm; font-size:13pt; font-weight:700; line-height:1.05; }
.plan td.scn .nodash{ font-size:8pt; }
.plan td.chr{ width:10mm; }
.plan td.chr .t{ font-weight:700; }
.plan td.pers{ width:27mm; color:var(--ink2); }
.plan tr.svc td{ background:var(--svc); color:var(--ink2); padding-top:.7mm; padding-bottom:.7mm; }
.plan tr.svc td.time .t{ font-weight:600; font-size:8pt; display:inline; }
.plan tr.svc td.time .dur{ margin-left:1.4mm; }
.plan .snote{ color:var(--mute); }
.plan tr.lunch td{ background:var(--acc-bg); }
.plan tr.lunch td.time{ border-left-color:var(--acc); }
.plan tr.lunch .what{ font-weight:700; color:var(--acc); letter-spacing:.06em; text-transform:uppercase; }
.plan tr.cont td.scn{ color:var(--mute); font-size:10pt; }
.plan tr.int td.time{ border-left-color:var(--int); }
.plan tr.nat td.time{ border-left-color:var(--nat); }
.ie{ display:inline-block; font-size:6.6pt; font-weight:700; letter-spacing:.05em; padding:.1mm 1.3mm; border-radius:1mm; margin-right:1.2mm; vertical-align:1px; }
.ie.int{ background:var(--int-bg); color:var(--int); }
.ie.nat{ background:var(--nat-bg); color:var(--nat); }
.slug{ font-weight:700; }
.slug .mode{ font-weight:400; color:var(--mute); }
.syn{ margin:.4mm 0 .5mm; }
.elist{ display:grid; grid-template-columns:minmax(16mm, max-content) 1fr; column-gap:2mm; font-size:7.4pt; line-height:1.22; color:var(--ink2); margin-top:.3mm; }
.elist .k{ color:var(--mute); font-size:6.3pt; font-weight:600; text-transform:uppercase; letter-spacing:.04em; padding-top:.25mm; overflow-wrap:anywhere; }
.pnote{ margin-top:.8mm; padding:.8mm 2mm; background:var(--note); border-left:2pt solid var(--note-line); font-size:7.4pt; white-space:pre-line; }
.plan .total td{ border-bottom:0; padding-top:1.2mm; font-weight:700; }
.u2h{ border-bottom-color:var(--u2); }
.u2h h2{ color:var(--u2); background:var(--u2-bg); }
.u2h h2::before, .u2h::after{ background:var(--u2); }
.plan.u2 th{ border-bottom-color:var(--u2); }
.plan.u2 tr td.time{ border-left-color:var(--u2); }

/* схема */
.scheme-page{ page:scheme; break-before:page; }
.schemeblk{ margin-top:0; break-inside:avoid; }
.scheme{ display:grid; grid-template-columns:1.15fr 1fr; gap:6mm; margin-top:2mm; }
.pt{ display:grid; grid-template-columns:6mm 1fr; gap:2mm; padding:1mm 0; border-bottom:.5pt solid var(--line); break-inside:avoid; }
.pt .n{ width:5mm; height:5mm; border-radius:50%; background:var(--ink); color:#fff; font-weight:700; font-size:7.5pt; display:flex; align-items:center; justify-content:center; }
.pt .n.acc{ background:var(--acc); }
.pt b{ display:block; }
.pt span{ color:var(--mute); }
.txt .lbl{ margin-top:1.6mm; }
.txt .lbl:first-child{ margin-top:0; }
.txt p{ margin:.4mm 0 0; white-space:pre-line; }
.map{ position:relative; height:150mm; margin-top:2mm; border:.6pt solid var(--line2); border-radius:1.5mm; background:repeating-linear-gradient(135deg,#f6f6f3 0 6px,#efefeb 6px 7px); }
.mapcap{ position:absolute; left:3mm; bottom:3mm; right:30mm; background:#fff; border:.5pt solid var(--line2); padding:1mm 2mm; font-size:7.4pt; color:var(--mute); }
.north{ position:absolute; right:3mm; bottom:3mm; background:#fff; border:.5pt solid var(--line2); padding:1mm 2mm; font-size:7.4pt; color:var(--mute); }
`;

/**
 * Чистая функция: модель → HTML листа. `fontCss` — `@font-face` со встроенным шрифтом
 * (`loadMedeoFontCss()`); без него — системный шрифт.
 */
export function buildCallSheetHtml(
  model: CallSheetPrintModel,
  options: { fontCss?: string } = {},
): string {
  const body = [
    headHtml(model),
    timesHtml(model),
    infoHtml(model),
    importantHtml(model),
    leadersCrewHtml(model),
    baseHtml(model),
    castHtml(model),
    groupsHtml(model),
    elementsHtml(model),
    planHtml(model),
    secondUnitHtml(model),
    schemeHtml(model),
  ]
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ru"><head>${PRINT_HTML_CSP_META}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(model.documentTitle)}</title>
<style>${options.fontCss ?? ""}
${pageCss(model)}
${SHEET_CSS}</style>
</head><body><main class="sheet">
${body}
</main></body></html>`;
}
