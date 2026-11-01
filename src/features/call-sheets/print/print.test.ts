import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { CallSheetBlocks } from "@/features/call-sheets/queries";
import type { ElementsEditorData } from "@/features/call-sheets/elements-queries";
import {
  loadMedeoFontCss,
  MEDEO_FONT_FILE_NAME,
  MEDEO_FONT_URL,
  MEDEO_FONT_VERSION,
  medeoFontPath,
} from "@/features/call-sheets/print/medeo-font";
import {
  buildCallSheetHtml,
  callSheetCsp,
  cssString,
  type CallSheetFontMode,
} from "@/features/call-sheets/print/print-html";
import {
  buildCallSheetPrintModel,
  formatTiming,
  type CallSheetPrintModel,
  type CallSheetPrintSource,
} from "@/features/call-sheets/print/print-model";
import {
  FULL_DAY_SOURCE,
  IRP_DAY_SOURCE,
  MIN_DAY_SOURCE,
} from "@/features/call-sheets/print/preview-fixtures";
import type { DayAstro } from "@/features/day-docs/lib/city-astro";
import type { DayDocBundle } from "@/features/day-docs/lib/build-day-doc";
import { PRINT_HTML_CSP_META } from "@/shared/lib/escape-html";

/**
 * Данные страницы вызывного подходят на вход модели как есть (проверка при `tsc`):
 * день КПП, вызывной, элементы площадки и погода.
 */
export function sourceFromPageData(
  bundle: DayDocBundle,
  sheet: CallSheetBlocks | null,
  elements: ElementsEditorData | null,
  astro: DayAstro | null,
): CallSheetPrintSource {
  return {
    project: bundle.project,
    day: bundle.day,
    actors: bundle.actors,
    workingDay: null,
    astro,
    sheet,
    elements,
  };
}

const SCRIPT = "<script>alert(1)</script>";
const IMG = `<img src=x onerror="alert(1)">`;
const QUOTES = `О'Брайен & "Ко"`;

function clone(source: CallSheetPrintSource): CallSheetPrintSource {
  return structuredClone(source);
}

function model(source: CallSheetPrintSource) {
  return buildCallSheetPrintModel(source);
}

function html(source: CallSheetPrintSource, font?: CallSheetFontMode) {
  return buildCallSheetHtml(model(source), { font });
}

/** Ключи объекта на любой глубине. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

/** Теги без значений атрибутов. */
function tags(markup: string) {
  return (markup.match(/<[^>]*>/g) ?? []).map((tag) => tag.replace(/"[^"]*"/g, '""'));
}

function styleOf(page: string) {
  return page.slice(page.indexOf("<style>") + "<style>".length, page.indexOf("</style>"));
}

function blockTitles(page: string) {
  return [...page.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
}

describe("модель листа вызывного", () => {
  test("самодостаточна: JSON туда и обратно без потерь, без id", () => {
    for (const source of [FULL_DAY_SOURCE, IRP_DAY_SOURCE, MIN_DAY_SOURCE]) {
      const m = model(source);
      assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
      const idKeys = [...allKeys(m)].filter((k) => k === "id" || /Id$/.test(k) || k === "ref");
      assert.deepEqual(idKeys, []);
      assert.equal(m.modelVersion, 1);
    }
  });

  test("шапка и полоса времён: смена диапазоном, «Конец смены» отдельно нет, t из прогноза", () => {
    const m = model(FULL_DAY_SOURCE);
    assert.equal(m.dateLabel, "вторник, 3 ноября 2026");
    assert.equal(m.shortDateLabel, "вт 03.11.2026");
    assert.equal(m.dayOfTotalLabel, "день 12 из 40");
    assert.deepEqual(m.crewCall, {
      time: "06:15",
      address: "м. «Достоевская», выход к Владимирской площади, автобус группы",
    });
    assert.deepEqual(
      m.times.map((t) => `${t.label} ${t.value}${t.accent ? " !" : ""}`),
      ["Смена 07:00–19:30", "Репетиция 07:45", "Мотор 08:30 !", "Обед 13:30–14:30", "Стоп-мотор 19:00 !"],
    );
    assert.equal(m.weather?.tempDay, "+6°", "t руками важнее прогноза");
    assert.equal(m.weather?.tempNight, "+2°", "не заполнена руками — из прогноза");
  });

  test("ИРП: объекты по адресу, 2-й юнит отметкой, хронометраж", () => {
    const m = model(IRP_DAY_SOURCE);
    assert.deepEqual(m.locations, [
      {
        address: "пр. Стачек, 47Е",
        rows: [
          { name: "Завод. Проходная 3", scenes: "сц. 129, 132", secondUnit: false },
          { name: "Кабина БМВ", scenes: "сц. 130", secondUnit: false },
          { name: "Завод. Кабина трактора", scenes: null, secondUnit: true },
        ],
      },
    ]);
    assert.equal(m.totals.sceneCount, 3);
    assert.equal(m.totals.dayTiming, "0′37″");
    assert.equal(m.totals.mainTiming, "0′37″", "продолжение сцены не считается второй раз");
  });

  test("вызов цехов — по строке на цех, порядок из вызывного, смена времени и самое раннее", () => {
    const m = model(IRP_DAY_SOURCE);
    assert.equal(m.crewCalls.length, 18);
    assert.deepEqual(
      m.crewCalls.slice(0, 5).map((r) => r.label),
      ["Администрация", "Рабочие, буфет", "Локейшн", "Режиссёрская группа", "Плейбек, механики"],
    );
    assert.deepEqual(
      m.crewCalls.flatMap((r, i) => (r.newTime ? [i] : [])),
      [3, 11, 16],
      "линия толще — там, где время сменилось",
    );
    assert.deepEqual(
      m.crewCalls.flatMap((r, i) => (r.earliest ? [i] : [])),
      [0, 1, 2],
    );
    const page = html(IRP_DAY_SOURCE);
    assert.equal(page.match(/<tr class="newt">/g)?.length, 3);
    assert.equal(page.match(/<tr class="early">/g)?.length, 3);
  });

  test("база: «не нужен» без времени и без зачёркивания", () => {
    const m = model(IRP_DAY_SOURCE);
    const grip = m.baseItems.find((r) => r.name === "Гриптрак")!;
    assert.deepEqual(grip, { name: "Гриптрак", time: null, notNeeded: true });
    const page = html(IRP_DAY_SOURCE);
    assert.ok(page.includes(`<div class="off"><span>Гриптрак</span><span class="t">не нужен</span></div>`));
    assert.doesNotMatch(page, /line-through|<s>|<del>/);
  });

  test("подача машины — только при «машина»; «сам» — прочерк; телефонов актёров нет", () => {
    const source = clone(IRP_DAY_SOURCE);
    // Режим сменили на «сам», а старое время в данных осталось — на лист не идёт.
    source.day.actorCalls[1] = { ...source.day.actorCalls[1]!, carPickupTime: "06:00" };
    const m = model(source);
    const [first, second] = m.cast;
    assert.deepEqual(first!.transport, { kind: "car", text: "машина" });
    assert.equal(first!.carPickup, "07:15");
    assert.deepEqual(second!.transport, { kind: "self", text: "сам" });
    assert.equal(second!.carPickup, null);
    assert.ok(!allKeys(m.cast).has("phone"));

    const page = buildCallSheetHtml(m);
    assert.ok(page.includes(`<th class="r pick">Подача машины</th>`));
    assert.ok(page.includes(`<td class="r pick"><span class="none">—</span></td>`));
    assert.ok(!page.includes("06:00"));
    assert.ok(page.includes(`<span class="chip car">машина</span>`));
    assert.ok(page.includes(`<span class="chip self">сам</span>`));
    // Свой текст — обычным текстом, без плашки.
    const custom = model(FULL_DAY_SOURCE).cast.find((c) => c.character === "Кирилл")!;
    assert.deepEqual(custom.transport, { kind: "custom", text: "такси, чек — администратору" });
  });

  test("ставки км спецтранспорта нет ни в модели, ни в HTML", () => {
    const source = clone(FULL_DAY_SOURCE);
    source.day.transports = source.day.transports.map((row) => ({ ...row, kmRate: 4321.5 }));
    const m = model(source);
    const transport = m.elementSections.find((s) => s.name === "Спецтранспорт");
    assert.equal(transport?.rows.length, 2);
    const keys = [...allKeys(m)];
    assert.ok(!keys.some((k) => /km|rate/i.test(k)), keys.join(", "));
    assert.ok(!JSON.stringify(m).includes("4321"));
    assert.ok(!html(source).includes("4321"));
    assert.doesNotMatch(html(source), /ставк|за км/i);
  });

  test("вырезанные сцены не попадают: план, актёры, объекты, итоги", () => {
    const source = clone(FULL_DAY_SOURCE);
    const cut = source.day.scenes.find((row) => row.scene.number === "16")!.scene;
    assert.ok(cut.cutAt, "в фикстуре сцена 16 вырезана");
    cut.locations = [{ location: { name: "Подвал (только в вырезанной)", sublocation: null, address: null } }];
    const slot = source.day.timeSlots.find((s) => s.scene?.number === "16")!;
    slot.scene = cut;

    const m = model(source);
    assert.ok(!m.plan.some((r) => r.kind === "scene" && r.sceneNumber === "16"));
    assert.equal(m.totals.sceneCount, 6);
    assert.equal(m.totals.dayTiming, "11′40″");
    assert.ok(!m.cast.some((c) => c.character === "Сосед снизу"));
    assert.ok(!m.cast.some((c) => c.scenes.split(", ").includes("16")));
    assert.ok(!m.locations.some((g) => g.rows.some((r) => r.name.startsWith("Подвал"))));
    const page = buildCallSheetHtml(m);
    assert.ok(!page.includes("Сосед снизу"));
    assert.ok(!page.includes("Подвал"));
  });

  test("план: служебные с длительностью, обед, продолжение, примечание, элементы сцены", () => {
    const m = model(IRP_DAY_SOURCE);
    const [makeup, , scene129] = m.plan;
    assert.deepEqual(makeup, {
      kind: "service",
      time: "07:30",
      duration: "1:30",
      label: "Грим, костюм, техническое освоение",
      note: null,
      lunch: false,
    });
    assert.ok(m.plan.some((r) => r.kind === "service" && r.lunch && r.label === "Обед"));
    assert.equal(scene129?.kind, "scene");
    if (scene129?.kind !== "scene") return;
    assert.equal(scene129.tone, "nat");
    assert.equal(scene129.intExtLabel, "НАТ");
    assert.equal(scene129.title, "Завод. Проходная 3");
    assert.equal(scene129.mode, "рассвет, день 10");
    assert.match(scene129.note ?? "", /хореографию/);
    assert.deepEqual(
      scene129.elements.map((el) => el.label),
      ["Групповка", "Транспорт", "Реквизит", "Техника", "CG"],
      "костюм, грим и спецтранспорт в строке сцены не повторяются",
    );
    assert.equal(scene129.elements[2]!.value, "Зонт чёрный для коллекторов, 2 шт");
    assert.equal(scene129.elements[3]!.value, "Steadicam Trinity, GoPro, 5 шт");
    assert.equal(scene129.timing, "0′10″");
    const cont = m.plan.find((r) => r.kind === "scene" && r.continuation);
    assert.ok(cont && cont.kind === "scene");
    assert.equal(cont.title, "Продолжение сцены 130");
    assert.equal(cont.elements.length, 0);

    const page = buildCallSheetHtml(m);
    assert.ok(page.includes(`<tr class="svc lunch">`));
    assert.ok(page.includes(`<tr class="int cont">`));
    assert.ok(page.includes(`<span class="ie nat">НАТ</span>`));
    assert.ok(page.includes(`<div class="pnote">`));
  });

  test("второй юнит — только если есть строки; строки «2-й юнит» без сцен — в его элементах", () => {
    const m = model(IRP_DAY_SOURCE);
    assert.equal(m.secondUnit.range, "16:00–19:30");
    const [row] = m.secondUnit.rows;
    assert.ok(row?.kind === "scene");
    assert.deepEqual(row.elements, [{ label: "Групповка", value: "Дублёр Вани, руки (1)" }]);
    assert.ok(html(IRP_DAY_SOURCE).includes("<h2>Второй юнит</h2>"));

    const noSecond = clone(IRP_DAY_SOURCE);
    noSecond.day.timeSlots = noSecond.day.timeSlots.filter((s) => s.unit === "MAIN");
    assert.ok(!html(noSecond).includes("Второй юнит"));
  });

  test("групповка — свой блок, в элементах её нет; спецтранспорт — разделом элементов", () => {
    const m = model(IRP_DAY_SOURCE);
    assert.deepEqual(
      m.groups.map((r) => r.name),
      ["Дублёр Коллектора 2", "Водитель беспилотного трактора", "Дублёр Вани, руки"],
    );
    const names = m.elementSections.map((s) => s.name);
    assert.ok(!names.includes("Групповка"));
    assert.equal(names.at(-1), "Спецтранспорт");
    assert.ok(!names.includes("Прочее"), "раздел без строк не выводится");
    const page = html(IRP_DAY_SOURCE);
    assert.ok(page.includes(`<td class="secname" rowspan="3">Игровой транспорт</td>`));
    assert.ok(page.includes(`<td class="secname">Реквизит</td>`), "один ряд — без rowspan");
    const full = model(FULL_DAY_SOURCE);
    const rows = full.elementSections.flatMap((s) => s.rows.map((r) => r.name));
    assert.ok(!rows.includes("Газета «Смена»"), "убранная авто-строка");
  });

  test("схема объекта: нет ни точек, ни текстов — листа схемы нет", () => {
    assert.equal(model(MIN_DAY_SOURCE).scheme, null, "пробел в «как добраться» — не текст");
    assert.ok(!html(MIN_DAY_SOURCE).includes(`class="scheme-page"`));
    const noScheme = clone(IRP_DAY_SOURCE);
    noScheme.sheet!.schemeLocation = null;
    assert.ok(!html(noScheme).includes(`class="scheme-page"`));
    assert.ok(!html(noScheme).includes("схема — в конце"));

    const irp = model(IRP_DAY_SOURCE);
    assert.equal(irp.scheme?.points.length, 3);
    assert.equal(irp.scheme?.parking, null);
    const page = html(IRP_DAY_SOURCE);
    assert.ok(page.includes(`class="scheme-page"`));
    assert.ok(page.includes("схема — в конце"));
    assert.ok(!page.includes("Парковка"), "пустая «Парковка» не печатается");
    // Схема — последняя и единственное место с принудительным разрывом.
    assert.ok(page.lastIndexOf("<h2>Схема объекта</h2>") > page.lastIndexOf("<h2>Второй юнит</h2>"));
    assert.equal(styleOf(page).match(/break-before:page/g)?.length, 1);
  });

  test("хронометраж — минуты ′ секунды ″, без часов, не «м:сс»", () => {
    assert.equal(formatTiming(37), "0′37″");
    assert.equal(formatTiming(700), "11′40″");
    assert.equal(formatTiming(65), "1′05″");
    assert.equal(formatTiming(3600), "60′00″");
    assert.equal(formatTiming(3725), "62′05″");
    assert.equal(formatTiming(6000), "100′00″");
    assert.equal(formatTiming(0), null);
    assert.equal(formatTiming(-5), null);
    assert.equal("′".codePointAt(0), 0x2032);
    assert.equal("″".codePointAt(0), 0x2033);

    // Везде на листе: строка сцены, итог юнита, шапка, бегущая шапка.
    const page = html(IRP_DAY_SOURCE);
    assert.ok(page.includes(`<td class="chr r"><span class="t">0′10″</span></td>`), "строка сцены");
    assert.ok(page.includes(`основного юнита</td><td class="r"><span class="t">0′37″</span>`), "итог юнита");
    assert.ok(page.includes(`хронометраж дня <span class="t">0′37″</span>`), "шапка");
    assert.ok(styleOf(page).includes("хрон. 0′37″"), "бегущая шапка");
    assert.ok(!styleOf(page).includes("хрон. 0:37"));
    assert.ok(!page.includes(">0:37<") && !page.includes(">0:10<"), "старого «м:сс» нет");
  });

  test("руководители: ФИ целиком одним начертанием", () => {
    const page = html(IRP_DAY_SOURCE);
    assert.ok(page.includes(`<td class="nm">Миронова Татьяна</td>`));
    assert.ok(!page.includes("<b>Миронова</b>"));
  });

  test("нет плана — сцены дня строками без времени", () => {
    const m = model(MIN_DAY_SOURCE);
    assert.equal(m.plan.length, 1);
    assert.ok(m.plan[0]?.kind === "scene" && m.plan[0].sceneNumber === "1" && m.plan[0].time === null);
  });
});

describe("HTML листа вызывного", () => {
  test("CSP первой строкой head, без скриптов и обработчиков", () => {
    const page = html(FULL_DAY_SOURCE);
    assert.ok(
      page.includes(
        `<head><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; font-src 'none'">`,
      ),
    );
    // Политика листа — общая печатная плюс источник шрифта.
    assert.ok(PRINT_HTML_CSP_META.includes(callSheetCsp("none").split("; font-src")[0]!));
    const t = tags(page);
    assert.equal(t.filter((tag) => /^<script\b/i.test(tag)).length, 0);
    assert.equal(t.filter((tag) => /\son[a-z]+\s*=/i.test(tag)).length, 0);
  });

  test("порядок блоков — как в макете", () => {
    assert.deepEqual(blockTitles(html(IRP_DAY_SOURCE)), [
      "Руководители группы",
      "Вызов цехов",
      "База и транспорт группы",
      "Актёры",
      "Групповка и дублёры",
      "Элементы площадки",
      "План съёмки · основной юнит",
      "Второй юнит",
      "Схема объекта",
    ]);
  });

  test("экранирование HTML: все поля из данных", () => {
    const source = clone(FULL_DAY_SOURCE);
    source.project.fullName = `Фильм ${SCRIPT}`;
    source.sheet!.importantNote = `Внимание ${IMG}\nвторая строка ${QUOTES}`;
    source.sheet!.actorRestrictions = SCRIPT;
    source.sheet!.leaders[0] = { position: QUOTES, shortTitle: null, personName: IMG, phone: SCRIPT };
    source.sheet!.crewCalls[0] = { label: IMG, callTime: "05:45" };
    source.sheet!.baseItems[0] = { name: SCRIPT, callTime: null, notNeeded: true };
    source.sheet!.schemeLocation!.points[0] = { number: IMG, name: SCRIPT, description: QUOTES };
    source.sheet!.schemeLocation!.directions = IMG;
    source.actors[0] = { ...source.actors[0]!, lastName: IMG, firstName: QUOTES };
    source.day.scenes[0]!.scene.characters[0] = { character: { id: "ch-anna", name: SCRIPT } };
    source.day.scenes[0]!.scene.summary = IMG;
    source.day.timeSlots[0]!.customLabel = SCRIPT;
    source.day.timeSlots[3]!.notes = IMG;
    source.day.actorCalls[3] = { ...source.day.actorCalls[3]!, transportText: SCRIPT };
    source.elements!.manual[0] = { ...source.elements!.manual[0]!, name: IMG, notes: SCRIPT };
    source.day.transports[0] = { ...source.day.transports[0]!, name: QUOTES, notes: IMG };
    source.day.crewMeetAddress = IMG;

    const page = html(source);
    assert.ok(!page.includes("<script>alert"));
    assert.ok(!page.includes("<img"));
    assert.ok(page.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(page.includes("Внимание &lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
    assert.ok(page.includes("О&#39;Брайен &amp; &quot;Ко&quot;"));
    assert.doesNotMatch(page, /&amp;(amp|lt|gt|quot|#39);/, "нет двойного экранирования");
    const t = tags(page);
    assert.equal(t.filter((tag) => /^<(script|img)\b/i.test(tag)).length, 0);
  });

  test("экранирование CSS-строк: \\, кавычка, переводы строк, </style>", () => {
    assert.equal(cssString(`a\\b`), `"a\\\\b"`);
    assert.equal(cssString(`say "hi"`), `"say \\"hi\\""`);
    assert.equal(cssString("две\nстроки\r\n"), `"две строки "`);
    assert.equal(cssString("</style>"), `"\\3C /style>"`);
    assert.equal(cssString("a" + String.fromCharCode(0x2028) + "b"), `"a b"`);

    // Бегущая шапка и подвал — из данных: тег <style> не закрыть, строку не разорвать.
    const source = clone(IRP_DAY_SOURCE);
    source.project.name = `ИРП"; } </style><script>alert(1)</script>\\`;
    source.day.crewMeetAddress = `адрес\n"x"`;
    const page = html(source);
    const style = styleOf(page);
    assert.ok(!style.includes("<"), "в <style> нет тегов");
    assert.ok(style.includes(`content:"ИРП\\"; } \\3C /style>\\3C script>alert(1)\\3C /script>\\\\ · пт 11.09.2026 · смена 40"`));
    assert.equal(page.match(/<\/style>/g)?.length, 1);
    assert.equal(page.match(/<style>/g)?.length, 1);
  });

  test("пустые блоки не печатаются; заполненные — на месте", () => {
    const minimal = blockTitles(html(MIN_DAY_SOURCE));
    assert.deepEqual(minimal, ["Руководители группы", "Актёры", "План съёмки · основной юнит"]);
    const page = html(MIN_DAY_SOURCE);
    for (const text of ["Важно", "Погода", "Место сбора", "Ограничения", "Второй юнит", "Схема объекта"]) {
      assert.ok(!page.includes(text), `нет «${text}»`);
    }
    // Колонки без единого значения скрыты: у актёра нет времён и транспорта.
    assert.ok(!page.includes(">Транспорт</th>"));
    assert.ok(!page.includes(">Готов</th>"));

    const full = blockTitles(html(FULL_DAY_SOURCE));
    for (const title of ["Руководители группы", "Вызов цехов", "База и транспорт группы", "Актёры", "Групповка и дублёры", "Элементы площадки", "План съёмки · основной юнит", "Второй юнит", "Схема объекта"]) {
      assert.ok(full.includes(title), `есть блок «${title}»`);
    }
  });

  test("вызывной не создан — блоков из шаблона, текстов и схемы нет, данные дня есть", () => {
    const page = html({ ...clone(FULL_DAY_SOURCE), sheet: null, elements: null });
    const titles = blockTitles(page);
    for (const title of ["Руководители группы", "Вызов цехов", "База и транспорт группы", "Групповка и дублёры", "Схема объекта"]) {
      assert.ok(!titles.includes(title), `нет блока «${title}»`);
    }
    assert.ok(!page.includes("Важно"));
    assert.ok(titles.includes("Актёры"));
    assert.ok(titles.includes("Элементы площадки"), "спецтранспорт дня — и без вызывного");
    assert.ok(titles.includes("План съёмки · основной юнит"));
  });

  test("разрывы и поля страницы: шапка листов 2+ и подвал — @page, не HTML", () => {
    const style = styleOf(html(IRP_DAY_SOURCE));
    assert.match(style, /@page\{ size:A4;/);
    assert.match(style, /@top-left\{ content:"ИРП · пт 11\.09\.2026 · смена 40"/);
    assert.match(style, /@page :first\{[^}]*@top-left\{ content:none;/);
    assert.match(style, /@bottom-right\{ content:"лист " counter\(page\) " из " counter\(pages\)/);
    assert.match(style, /thead\{ display:table-header-group; \}/);
    assert.match(style, /tr\{ break-inside:avoid; \}/);
    assert.match(style, /\.bh\{[^}]*break-after:avoid;/);
  });

  test("размеры: нигде меньше 6,3pt; данные плана и примечаний — не меньше 7,4pt; курсива нет", () => {
    const page = html(FULL_DAY_SOURCE);
    const style = styleOf(page);
    const sizes = [...style.matchAll(/(?:font-size:|font:(?:\d{3} )?)(\d+(?:\.\d+)?)pt/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length > 20);
    assert.ok(Math.min(...sizes) >= 6.3, `минимум ${Math.min(...sizes)}pt`);
    for (const cls of [".elist{", ".pnote{", ".enote{", ".plan td.time .dur{"]) {
      const rule = style.slice(style.indexOf(cls), style.indexOf("}", style.indexOf(cls)));
      const size = Number(rule.match(/font-size:(\d+(?:\.\d+)?)pt/)?.[1]);
      assert.ok(size >= 7.4, `${cls} ${size}pt`);
    }
    assert.ok(!/italic|oblique/.test(page));
    assert.match(style, /\*\{ box-sizing:border-box; font-style:normal; \}/);
    assert.match(style, /font-variant-numeric:tabular-nums/);
  });

  test("шрифт: Medeo Sans из medeo-font (версия точная), только вариативный прямой, data:", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    assert.equal(pkg.dependencies["medeo-font"], "1.0.0-rc.4.1", "версия без ^ и ~");
    const file = medeoFontPath();
    assert.match(file.replaceAll("\\", "/"), /node_modules\/medeo-font\/dist\/fonts\/medeo-sans\/MedeoSansVariable\.woff2$/);
    assert.ok(existsSync(file));
    const css = loadMedeoFontCss();
    assert.equal(css.match(/@font-face/g)?.length, 1);
    assert.match(css, /font-family:"Medeo Sans";font-style:normal;font-weight:100 900;/);
    assert.equal(css.match(/url\(data:font\/woff2;base64,/g)?.length, 1);
    assert.ok(!/url\((?!data:)/.test(css), "никаких внешних адресов");
    assert.ok(!/italic/i.test(css), "курсив не встраивается");
    const embedded = html(MIN_DAY_SOURCE, "embed");
    assert.ok(embedded.includes(css), "печать — шрифт встроен");
    assert.ok(embedded.includes(`content="${callSheetCsp("embed")}"`));
    assert.match(callSheetCsp("embed"), /font-src data:$/);
    // Файлы IBM Plex для листа убраны.
    assert.ok(!existsSync(path.join(process.cwd(), "assets", "fonts", "ibm-plex-sans")));
    const config = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    assert.ok(config.includes("./node_modules/medeo-font/dist/fonts/medeo-sans/MedeoSansVariable.woff2"));
  });

  test("модель без лишних полей шаблона попадает в HTML как есть", () => {
    const m: CallSheetPrintModel = { ...model(MIN_DAY_SOURCE), important: "Проверка" };
    assert.ok(buildCallSheetHtml(m).includes(`<p>Проверка</p>`));
  });
});

describe("шрифт листа по адресу (просмотр на странице)", () => {
  test("режим url: @font-face с адресом файла, без base64, CSP — шрифт только со своего сайта", () => {
    const page = html(FULL_DAY_SOURCE, "url");
    assert.ok(page.includes(`src:url(${MEDEO_FONT_URL}) format("woff2")`));
    assert.ok(!page.includes("base64"), "шрифт не встроен");
    assert.ok(page.includes(`content="${callSheetCsp("url")}"`));
    assert.match(callSheetCsp("url"), /font-src 'self'$/);
    assert.ok(Buffer.byteLength(page) < 80 * 1024, `лист без шрифта лёгкий: ${Buffer.byteLength(page)} байт`);
    assert.ok(Buffer.byteLength(html(FULL_DAY_SOURCE, "embed")) > 400 * 1024, "печать — со шрифтом внутри");
  });

  test("имя файла — с версией пакета (та же, что в package.json и node_modules)", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const installed = JSON.parse(
      readFileSync(path.join(process.cwd(), "node_modules", "medeo-font", "package.json"), "utf8"),
    );
    assert.equal(MEDEO_FONT_VERSION, pkg.dependencies["medeo-font"]);
    assert.equal(MEDEO_FONT_VERSION, installed.version);
    assert.equal(MEDEO_FONT_FILE_NAME, `medeo-sans-variable-${MEDEO_FONT_VERSION}.woff2`);
    assert.equal(MEDEO_FONT_URL, `/api/fonts/${MEDEO_FONT_FILE_NAME}`);
  });

  test("маршрут шрифта: только этот файл, кэш навсегда; другое имя — 404", async () => {
    const { GET } = await import("@/app/api/fonts/[file]/route");
    const ok = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ file: MEDEO_FONT_FILE_NAME }) });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("Content-Type"), "font/woff2");
    assert.equal(ok.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), readFileSync(medeoFontPath()));
    for (const file of ["../../package.json", "MedeoSansVariable.woff2", "medeo-sans-variable-0.0.1.woff2"]) {
      const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ file }) });
      assert.equal(res.status, 404, file);
    }
    const config = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    assert.match(config, /"\/api\/fonts\/\*\*": \["\.\/node_modules\/medeo-font\/dist\/fonts\/medeo-sans\/MedeoSansVariable\.woff2"\]/);
  });

  test("страница вызывного не кладёт HTML листа в свои данные: iframe берёт его маршрутом с проверкой права", () => {
    const pagePath = "src/app/[locale]/projects/[projectId]/call-sheets/[dayId]/page.tsx";
    const pageSource = readFileSync(path.join(process.cwd(), pagePath), "utf8");
    assert.ok(!pageSource.includes("buildCallSheetHtml"), "страница не собирает HTML");
    assert.ok(!pageSource.includes("loadMedeoFontCss"), "страница не встраивает шрифт");
    assert.ok(pageSource.includes("callSheetPreviewSrc("));
    const route = readFileSync(
      path.join(process.cwd(), "src/app/api/projects/[projectId]/call-sheets/[dayId]/sheet/route.ts"),
      "utf8",
    );
    assert.ok(
      route.includes(
        `return callSheetSheetResponse(
    await loadCallSheetPrintModel(projectId, dayId, new URL(request.url).searchParams.get("version")),`,
      ),
    );
  });
});
