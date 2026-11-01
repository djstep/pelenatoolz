import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { CallSheetBlocks } from "@/features/call-sheets/queries";
import type { ElementsEditorData } from "@/features/call-sheets/elements-queries";
import { buildCallSheetHtml } from "@/features/call-sheets/print/print-html";
import {
  buildCallSheetPrintModel,
  type CallSheetPrintModel,
  type CallSheetPrintSource,
} from "@/features/call-sheets/print/print-model";
import {
  loadPlexFontCss,
  PLEX_FONT_DIR,
  PLEX_FONT_FILES,
} from "@/features/call-sheets/print/plex-font";
import { FULL_DAY_SOURCE, MIN_DAY_SOURCE } from "@/features/call-sheets/print/preview-fixtures";
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

function html(source: CallSheetPrintSource, fontCss?: string) {
  return buildCallSheetHtml(buildCallSheetPrintModel(source), { fontCss });
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

describe("модель листа вызывного", () => {
  test("самодостаточна: JSON туда и обратно без потерь, без id и без дат-объектов", () => {
    const model = buildCallSheetPrintModel(FULL_DAY_SOURCE);
    assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
    const idKeys = [...allKeys(model)].filter((k) => k === "id" || /Id$/.test(k) || k === "ref");
    assert.deepEqual(idKeys, []);
    assert.equal(model.modelVersion, 1);
  });

  test("сводка дня: дата без сдвига пояса, смена, день N из M, обед основного юнита", () => {
    const model = buildCallSheetPrintModel(FULL_DAY_SOURCE);
    assert.equal(model.dateLabel, "вторник, 3 ноября 2026 г.");
    assert.equal(model.shiftLabel, "Смена 12");
    assert.equal(model.dayOfTotalLabel, "День 12 из 40");
    assert.deepEqual(
      model.times.map((t) => `${t.label} ${t.value}`),
      ["Сбор 06:15", "Смена 07:00", "Репетиция 07:45", "Мотор 08:30", "Обед 13:30–14:30", "Стоп 19:00", "Конец смены 19:30"],
    );
    assert.equal(model.weather?.tempDay, "+6°", "t руками важнее прогноза");
    assert.equal(model.weather?.sunrise, "08:21");
  });

  test("общее время вызова не повторяется в «Сбор» и «Смена»", () => {
    const model = buildCallSheetPrintModel(MIN_DAY_SOURCE);
    assert.deepEqual(model.times, [{ label: "Сбор", value: "09:00" }]);
  });

  test("ставки км спецтранспорта в модели нет", () => {
    const source = clone(FULL_DAY_SOURCE);
    source.day.transports = source.day.transports.map((row) => ({ ...row, kmRate: 4321.5 }));
    const model = buildCallSheetPrintModel(source);
    assert.equal(model.specialTransport.length, 2);
    const keys = [...allKeys(model)];
    assert.ok(!keys.some((k) => /km|rate/i.test(k)), keys.join(", "));
    assert.ok(!JSON.stringify(model).includes("4321"));
    assert.ok(!html(source).includes("4321"));
    assert.doesNotMatch(html(source), /ставк|за км/i);
  });

  test("вырезанные сцены не попадают: ни в сцены, ни в актёров, ни в объекты, ни в итоги", () => {
    const source = clone(FULL_DAY_SOURCE);
    const cut = source.day.scenes.find((row) => row.scene.number === "16")!;
    assert.ok(cut.scene.cutAt, "в фикстуре сцена 16 вырезана");
    cut.scene.locations = [{ location: { name: "Подвал (только в вырезанной)", sublocation: null, address: null } }];

    const model = buildCallSheetPrintModel(source);
    assert.ok(!model.scenes.some((s) => s.number === "16"));
    assert.equal(model.sceneTotals.count, 6);
    assert.equal(model.sceneTotals.timing, "11:40");
    assert.ok(!model.cast.some((c) => c.character === "Сосед снизу"));
    assert.ok(!model.cast.some((c) => c.scenes.split(", ").includes("16")));
    assert.ok(!model.locations.some((l) => l.name.startsWith("Подвал")));
    const page = buildCallSheetHtml(model);
    assert.ok(!page.includes("Сосед снизу"));
    assert.ok(!page.includes("Подвал"));
  });

  test("актёры: транспорт «машина / сам / свой текст», сцены по порядку, без телефонов", () => {
    const model = buildCallSheetPrintModel(FULL_DAY_SOURCE);
    const byName = new Map(model.cast.map((c) => [c.character, c]));
    assert.equal(byName.get("Анна Орлова")?.transport, "Машина, подача 05:50");
    assert.equal(byName.get("Павел Орлов")?.transport, "Сам");
    assert.equal(byName.get("Кирилл")?.transport, "такси, чек — администратору");
    assert.equal(byName.get("Официант")?.transport, null);
    assert.equal(byName.get("Анна Орлова")?.scenes, "14, 15, 22, 23");
    assert.ok(!allKeys(model.cast).has("phone"));
  });

  test("элементы: скрытые авто-строки и «Спецтранспорт» не идут, пустые разделы убраны", () => {
    const model = buildCallSheetPrintModel(FULL_DAY_SOURCE);
    const names = model.elementSections.map((s) => s.name);
    assert.ok(!names.includes("Спецтранспорт"));
    assert.ok(!names.includes("Прочее"), "раздел без строк не выводится");
    assert.ok(names.includes("CG"), "ручные строки — в своём разделе");
    const rows = model.elementSections.flatMap((s) => s.rows.map((r) => r.name));
    assert.ok(!rows.includes("Газета «Смена»"), "убранная авто-строка");
    assert.ok(rows.includes("Вторая камера (общий план набережной)"));
  });
});

describe("HTML листа вызывного", () => {
  test("CSP первой строкой head, без скриптов и обработчиков", () => {
    const page = html(FULL_DAY_SOURCE);
    assert.ok(page.includes(`<head>${PRINT_HTML_CSP_META}`));
    const t = tags(page);
    assert.equal(t.filter((tag) => /^<script\b/i.test(tag)).length, 0);
    assert.equal(t.filter((tag) => /\son[a-z]+\s*=/i.test(tag)).length, 0);
  });

  test("экранирование: проект, руководители, актёры, «Важно», ограничения, элементы, спецтранспорт", () => {
    const source = clone(FULL_DAY_SOURCE);
    source.project.fullName = `Фильм ${SCRIPT}`;
    source.sheet!.importantNote = `Внимание ${IMG}\nвторая строка ${QUOTES}`;
    source.sheet!.actorRestrictions = SCRIPT;
    source.sheet!.leaders[0] = { position: QUOTES, personName: IMG, phone: SCRIPT };
    source.sheet!.crewCalls[0] = { label: IMG, callTime: "05:45" };
    source.sheet!.baseItems[0] = { name: SCRIPT, callTime: null, notNeeded: true };
    source.actors[0] = { ...source.actors[0], lastName: IMG, firstName: QUOTES };
    source.day.scenes[0].scene.characters[0] = { character: { id: "ch-anna", name: SCRIPT } };
    source.day.scenes[0].scene.summary = IMG;
    source.elements!.manual[0] = { ...source.elements!.manual[0], name: IMG, notes: SCRIPT };
    source.day.transports[0] = { ...source.day.transports[0], name: QUOTES, notes: IMG };
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

  test("в CSS из данных попадает только дата, и то без кавычек и скобок", () => {
    const model: CallSheetPrintModel = {
      ...buildCallSheetPrintModel(MIN_DAY_SOURCE),
      dateLabel: `5 ноября"; } </style><script>alert(1)</script>`,
    };
    const page = buildCallSheetHtml(model);
    const style = page.slice(page.indexOf("<style>") + "<style>".length, page.indexOf("</style>"));
    assert.ok(!style.includes("<"), "в <style> нет тегов");
    assert.match(style, /content: "Вызывной лист · 5 ноября  stylescriptalert1script"/);
    // Проект в CSS не попадает вовсе.
    const withName = html({ ...clone(MIN_DAY_SOURCE), project: { name: "Уникальное-имя", fullName: null } });
    const css = withName.slice(withName.indexOf("<style>"), withName.indexOf("</style>"));
    assert.ok(!css.includes("Уникальное-имя"));
  });

  test("пустые блоки не печатаются; заполненные — на месте", () => {
    const minimal = html(MIN_DAY_SOURCE);
    for (const title of ["Важно", "Ограничения по актёрам", "Вызов цехов", "База и транспорт", "Элементы площадки", "Спецтранспорт"]) {
      assert.ok(!minimal.includes(`<h2>${title}</h2>`), `нет блока «${title}»`);
    }
    for (const title of ["Руководители", "Актёры", "Сцены дня"]) {
      assert.ok(minimal.includes(`<h2>${title}</h2>`), `есть блок «${title}»`);
    }
    assert.ok(!minimal.includes("Погода"), "нет погоды — нет строки");
    assert.ok(!minimal.includes("Место сбора"));
    assert.ok(!minimal.includes("—</td>"), "пустые ячейки не забиты прочерками");
    // Колонки без единого значения скрыты: у актёра нет времён и транспорта.
    assert.ok(!minimal.includes("<th>Транспорт</th>"));
    assert.ok(!minimal.includes('<th class="time">Грим</th>'));

    const full = html(FULL_DAY_SOURCE);
    for (const title of ["Важно", "Ограничения по актёрам", "Руководители", "Вызов цехов", "База и транспорт", "Актёры", "Элементы площадки", "Спецтранспорт", "Сцены дня"]) {
      assert.ok(full.includes(`<h2>${title}</h2>`), `есть блок «${title}»`);
    }
  });

  test("вызывной не создан — блоков из шаблона и текстов нет, данные дня есть", () => {
    const page = html({ ...clone(FULL_DAY_SOURCE), sheet: null, elements: null });
    for (const title of ["Важно", "Ограничения по актёрам", "Руководители", "Вызов цехов", "База и транспорт", "Элементы площадки"]) {
      assert.ok(!page.includes(`<h2>${title}</h2>`), `нет блока «${title}»`);
    }
    assert.ok(page.includes("<h2>Актёры</h2>"));
    assert.ok(page.includes("<h2>Спецтранспорт</h2>"));
  });

  test("шрифт: файлы IBM и лицензия на месте, встраиваются как data:font/woff2", () => {
    for (const file of [...PLEX_FONT_FILES, "OFL.txt"]) {
      assert.ok(existsSync(path.join(process.cwd(), PLEX_FONT_DIR, file)), file);
    }
    const css = loadPlexFontCss();
    assert.equal(css.match(/@font-face/g)?.length, 6);
    assert.equal(css.match(/url\(data:font\/woff2;base64,/g)?.length, 6);
    assert.ok(!/url\((?!data:)/.test(css), "никаких внешних адресов");
    assert.ok(html(MIN_DAY_SOURCE, css).includes('font-family:"IBM Plex Sans"'));
  });
});
