import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";
import type { AuditionScheduleRow } from "@/features/auditions/lib/schedule-shared";
import {
  buildSchedulePrintHtml,
  type ScheduleExportField,
} from "@/features/auditions/lib/export-schedule";
import type { CastListExportBundle } from "@/features/casting/lib/cast-list-export-data";
import type { CastListCandidateExportConfig } from "@/features/casting/lib/cast-list-export-fields";
import { buildCastListPrintHtml } from "@/features/casting/lib/export-cast-list";
import {
  buildCallSheetPrintHtml,
  type CallSheetExportModel,
} from "@/features/day-docs/lib/export-call-sheet";
import {
  buildSceneScriptPrintHtml,
  type SceneScriptExportOptions,
} from "@/features/screenplay/lib/export-scene-script";
import { buildScreenplayPrintHtml } from "@/features/screenplay/lib/export-screenplay";
import type { LibrettoScene } from "@/features/script/lib/libretto-display";
import { PRINT_HTML_CSP_META } from "@/shared/lib/escape-html";
import { PRINT_IMAGES_TIMEOUT_MS, printWhenImagesSettled } from "@/shared/lib/print-window";

/** Все печатные страницы: сборка строкой на сервере → `document.write` в новую вкладку. */

const IMG = "ТЕСТ <img src=x onerror=alert(1)>";
const IMG_ESCAPED = "ТЕСТ &lt;img src=x onerror=alert(1)&gt;";
const SCRIPT = "<script>alert(1)</script>";
const QUOTES = `А & Б " ' onmouseover="alert(1)"`;
const QUOTES_ESCAPED = "А &amp; Б &quot; &#39; onmouseover=&quot;alert(1)&quot;";

const BAD_URLS = [
  "javascript:alert(1)",
  "JAVASCRIPT:alert(1)",
  "java\tscript:alert(1)",
  " javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "//evil.com/x",
  "/\\evil.com/x",
];

/** Теги без значений атрибутов: значения в кавычках убраны, остаются только имена. */
function tagsWithoutValues(html: string) {
  return (html.match(/<[^>]*>/g) ?? []).map((tag) => tag.replace(/"[^"]*"/g, '""'));
}

function assertInert(html: string) {
  const tags = tagsWithoutValues(html);
  assert.ok(html.includes(`<head>${PRINT_HTML_CSP_META}`) || html.includes(`<head>\n  ${PRINT_HTML_CSP_META}`), "CSP первой строкой head");
  assert.equal(tags.filter((t) => /^<script\b/i.test(t)).length, 0, "нет <script>");
  assert.equal(tags.filter((t) => /\son[a-z]+\s*=/i.test(t)).length, 0, "нет обработчиков on*=");
  assert.equal(tags.filter((t) => /^<img\b/i.test(t) && /\ssrc=x/i.test(t)).length, 0, "нет <img src=x>");
  assert.doesNotMatch(html, /&amp;(amp|lt|gt|quot|#39);/, "нет двойного экранирования");
  assert.doesNotMatch(html, /(href|src)="\s*(javascript|data|vbscript):/i, "нет опасных адресов");
}

describe("печать плана проб", () => {
  const fields: ScheduleExportField[] = ["time", "kind", "photo", "name", "character", "roleType", "rating", "comment", "notesBlank"];

  function schedule(photoUrl: string | null): AuditionScheduleRow[] {
    return [
      {
        id: "s1",
        projectId: "p1",
        date: "2026-11-01",
        time: "10:00",
        comment: QUOTES,
        createdAt: "2026-11-01",
        updatedAt: "2026-11-01",
        dateKey: "2026-11-01",
        kind: "LIVE" as AuditionScheduleRow["kind"],
        candidates: [
          {
            linkId: "l1",
            castingCandidateId: "c1",
            rating: 4,
            person: { id: "a1", photoUrl, lastName: IMG, firstName: null, middleName: null, label: IMG },
            character: { id: "ch1", name: SCRIPT, roleType: null },
          },
        ],
      },
    ];
  }

  test("текст из базы — текстом", () => {
    const html = buildSchedulePrintHtml(`Проект ${SCRIPT}`, schedule(null), fields);
    assertInert(html);
    assert.ok(html.includes(IMG_ESCAPED));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes(QUOTES_ESCAPED));
    assert.ok(html.includes("<td>4</td>"));
  });

  test("кавычки в адресе фото не выходят из атрибута", () => {
    const dq = buildSchedulePrintHtml("П", schedule(`https://example.com/a.png" onmouseover="alert(1)`), fields);
    assertInert(dq);
    assert.ok(dq.includes(`src="https://example.com/a.png&quot; onmouseover=&quot;alert(1)"`));
    const sq = buildSchedulePrintHtml("П", schedule(`https://example.com/a.png' onmouseover='alert(1)`), fields);
    assertInert(sq);
    assert.ok(sq.includes(`src="https://example.com/a.png&#39; onmouseover=&#39;alert(1)"`));
  });

  test("фото: http(s) и путь сайта — да, остальное — «—»", () => {
    assert.ok(buildSchedulePrintHtml("П", schedule("/uploads/p1/a.jpg"), fields).includes(`<img src="/uploads/p1/a.jpg"`));
    for (const url of [...BAD_URLS, "@evil.com/x.png"]) {
      const html = buildSchedulePrintHtml("П", schedule(url), fields);
      assertInert(html);
      assert.ok(!html.includes("<img"), url);
    }
  });

  test("кнопки с onclick внутри страницы нет", () => {
    assert.ok(!buildSchedulePrintHtml("П", schedule(null), fields).includes("window.print"));
  });
});

describe("печать каст-листа", () => {
  const bundle: CastListExportBundle = {
    project: { id: "p1", name: `Проект ${SCRIPT}`, fullName: null },
    character: { id: "ch1", name: IMG, description: QUOTES, roleRequirements: null, roleType: null, roleTypeLabel: null },
    locale: "ru",
    candidates: [
      {
        id: "c1",
        status: "NEW" as CastListExportBundle["candidates"][number]["status"],
        statusLabel: "Новый",
        rating: 5,
        notes: IMG,
        createdAt: new Date("2026-11-01"),
        person: {
          id: "a1",
          photoUrl: "/uploads/p1/a.jpg",
          lastName: IMG,
          firstName: null,
          middleName: null,
          label: IMG,
          birthDate: null,
          education: null,
          filmography: null,
          phone: null,
          email: null,
          agentName: null,
          agentPhone: null,
          agentEmail: null,
          physicalParams: {},
          skills: [],
          notes: null,
        },
        comments: [{ id: "cm1", body: SCRIPT, createdAt: new Date("2026-11-01"), authorName: "О'Нил" }],
        auditions: [],
      },
    ],
  };

  function build(cfg: Partial<CastListCandidateExportConfig>) {
    return buildCastListPrintHtml({
      bundle,
      characterFieldIds: ["name", "description"],
      actorFieldIds: ["photo", "notes"],
      sort: "nameAsc",
      candidateConfigs: [{ candidateId: "c1", photoOverrideUrl: null, tapes: [], commentIds: null, commentsManual: false, ...cfg }],
    });
  }

  test("имена, заметки, комментарии — текстом", () => {
    const html = build({});
    assertInert(html);
    assert.ok(html.includes(IMG_ESCAPED));
    assert.ok(html.includes(QUOTES_ESCAPED));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes("О&#39;Нил"));
    assert.ok(!html.includes("window.print"));
  });

  test("фото: путь сайта — с APP_URL, «@evil.com» и прочее — отбрасывается", () => {
    const savedAppUrl = process.env.APP_URL;
    process.env.APP_URL = "https://app.example";
    try {
      assert.ok(build({}).includes(`src="https://app.example/uploads/p1/a.jpg"`));
    } finally {
      if (savedAppUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = savedAppUrl;
    }
    assert.ok(build({ photoOverrideUrl: "https://cdn.example.com/b.jpg" }).includes(`src="https://cdn.example.com/b.jpg"`));
    for (const url of ["@evil.com/x.png", ...BAD_URLS]) {
      const html = build({ photoOverrideUrl: url });
      assertInert(html);
      assert.ok(!html.includes("<img"), url);
      assert.ok(!html.includes("evil.com"), url);
    }
  });

  test("внешние ссылки проб: опасные — только текст, без href", () => {
    const tapes = BAD_URLS.map((url, i) => ({ id: `t${i}`, kind: "external" as const, url, note: "" }));
    const html = build({ tapes: [...tapes, { id: "ok", kind: "external", url: "https://example.com/v", note: `' onmouseover='alert(1)` }] });
    assertInert(html);
    assert.ok(html.includes(`<a href="https://example.com/v">&#39; onmouseover=&#39;alert(1)</a>`));
    assert.equal((html.match(/<a href=/g) ?? []).length, 2, "ссылка на карточку и одна внешняя");
    assert.ok(html.includes("<li>javascript:alert(1)"));
  });
});

const scene = {
  id: "sc1",
  number: 1,
  postfix: "",
  episodeNumber: 0,
  intExt: "INT",
  dayNight: "DAY",
  scriptDay: null,
  planSeconds: null,
  summary: IMG,
  scriptContent: null,
  locations: [{ location: { name: IMG, sublocation: null, address: null } }],
  characters: [{ character: { name: SCRIPT, actors: [] } }],
  resources: [],
  elements: [],
} as unknown as LibrettoScene;

const sceneOpts: SceneScriptExportOptions = {
  showCharacters: true,
  showExtras: false,
  showGroup: false,
  showEpisodeNumber: true,
  showProjectHeader: true,
  contentMode: "full",
  pdfPreset: "classic",
  projectName: `Проект ${QUOTES}`,
  projectType: "FEATURE",
};

describe("печать сценария, сцен, роли, вызывного", () => {
  test("сценарий целиком", () => {
    const html = buildScreenplayPrintHtml([{ type: "ACTION", content: IMG }, { type: "DIALOGUE", content: QUOTES }], `Название ${SCRIPT}`);
    assertInert(html);
    assert.ok(html.includes(IMG_ESCAPED));
    assert.ok(html.includes(QUOTES_ESCAPED));
    assert.ok(html.includes("<title>Название &lt;script&gt;alert(1)&lt;/script&gt;</title>"));
  });

  test("сцены (и режиссёрский — краткое содержание)", () => {
    const full = buildSceneScriptPrintHtml([scene], [{ type: "ACTION", content: IMG, sceneId: "sc1" }], sceneOpts);
    assertInert(full);
    assert.ok(full.includes(`<p class="screenplay-block screenplay-block--action">${IMG_ESCAPED}</p>`));
    assert.ok(full.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(full.includes(QUOTES_ESCAPED));
    const summary = buildSceneScriptPrintHtml([scene], [], { ...sceneOpts, contentMode: "summary" });
    assertInert(summary);
    assert.ok(summary.includes(`<p class="screenplay-block">${IMG_ESCAPED}</p>`));
  });

  test("роль — те же настройки, что в actor-script-export (окно и zip)", () => {
    const html = buildSceneScriptPrintHtml([scene], [{ type: "DIALOGUE", content: IMG, sceneId: "sc1" }], {
      ...sceneOpts,
      showExtras: false,
      showGroup: false,
    });
    assertInert(html);
    assert.ok(html.includes(IMG_ESCAPED));
  });

  test("вызывной лист", () => {
    const model: CallSheetExportModel = {
      fileBaseName: "f",
      documentTitle: IMG,
      projectName: `Проект ${SCRIPT}`,
      dateLabel: "1 ноября",
      city: QUOTES,
      headerLine: "Смена 1",
      badges: [IMG],
      meta: [{ label: "Погода", value: IMG }],
      notes: IMG,
      departments: [{ role: "Режиссёр", person: IMG, info: QUOTES }],
      transports: [],
      slots: [{ timeRange: "10:00–11:00", duration: null, typeLabel: "Съёмка", title: IMG, details: [SCRIPT], notes: null }],
      cast: [],
      perShiftResources: [],
      resourceSections: [],
      scenesSummary: [{ scene: IMG, characters: SCRIPT, timing: "1:00" }],
      locationsSummary: IMG,
      nextDay: null,
    };
    const html = buildCallSheetPrintHtml(model);
    assertInert(html);
    assert.ok(html.includes(IMG_ESCAPED));
    assert.ok(html.includes(QUOTES_ESCAPED));
    assert.ok(html.includes(`<title>${IMG_ESCAPED}</title>`));
  });
});

describe("автопечать проб и кастинга", () => {
  function fakeImage(complete: boolean) {
    const listeners: Record<string, () => void> = {};
    return {
      complete,
      addEventListener: (type: "load" | "error", fn: () => void) => {
        listeners[type] = fn;
      },
      fire: (type: "load" | "error") => listeners[type]?.(),
    };
  }

  function fakeWindow(images: ReturnType<typeof fakeImage>[]) {
    const calls: string[] = [];
    return {
      calls,
      win: { focus: () => calls.push("focus"), print: () => calls.push("print"), document: { images } },
    };
  }

  test("фото нет или уже готовы — печать сразу", () => {
    const { calls, win } = fakeWindow([fakeImage(true)]);
    printWhenImagesSettled(win);
    assert.deepEqual(calls, ["focus", "print"]);
  });

  test("ждёт все фото: одно загрузилось, другое с ошибкой (404) — печать один раз", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const a = fakeImage(false);
      const b = fakeImage(false);
      const { calls, win } = fakeWindow([a, b]);
      printWhenImagesSettled(win);
      a.fire("load");
      assert.deepEqual(calls, []);
      b.fire("error");
      assert.deepEqual(calls, ["focus", "print"]);
      mock.timers.tick(PRINT_IMAGES_TIMEOUT_MS);
      assert.deepEqual(calls, ["focus", "print"]);
    } finally {
      mock.timers.reset();
    }
  });

  test("хост не отвечает — печать через 5 с, поздний ответ не печатает второй раз", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const a = fakeImage(false);
      const { calls, win } = fakeWindow([a]);
      printWhenImagesSettled(win);
      mock.timers.tick(PRINT_IMAGES_TIMEOUT_MS - 1);
      assert.deepEqual(calls, []);
      mock.timers.tick(1);
      assert.deepEqual(calls, ["focus", "print"]);
      a.fire("error");
      assert.deepEqual(calls, ["focus", "print"]);
    } finally {
      mock.timers.reset();
    }
  });
});
