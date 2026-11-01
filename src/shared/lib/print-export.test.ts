import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { execSync } from "node:child_process";
import { asPrintHtml, PRINT_FAILED, printServerHtml } from "@/shared/lib/print-window";

/**
 * Все окна печати — по схеме вызывного: окно по клику до запроса к серверу, потом HTML;
 * ошибка — окно закрывается, сообщение. `window.open` — только в `print-window.ts`.
 */

function source(relative: string) {
  return readFileSync(path.join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");
}

const PRINT_SITES = [
  "src/features/casting/components/cast-list-export-modal.tsx",
  "src/features/auditions/components/schedule-export-modal.tsx",
  "src/features/script/components/script-export-modals.tsx",
  "src/features/screenplay/components/character-script-button.tsx",
  "src/features/screenplay/components/screenplay-workspace.tsx",
];

function fakeWindow() {
  const calls: string[] = [];
  const written: string[] = [];
  return {
    calls,
    written,
    win: {
      focus: () => calls.push("focus"),
      print: () => calls.push("print"),
      close: () => calls.push("close"),
      document: { images: [], write: (html: string) => written.push(html), close: () => undefined },
    },
  };
}

describe("ответ выгрузки → окно печати", () => {
  test("asPrintHtml: ошибка, HTML с предупреждением, файл вместо HTML", () => {
    assert.deepEqual(asPrintHtml({ error: "Нет прав" }), { error: "Нет прав" });
    assert.deepEqual(asPrintHtml({ html: "<p>x</p>", fileName: "a.html" }), { html: "<p>x</p>" });
    assert.deepEqual(asPrintHtml({ html: "<p>x</p>", warning: "Фото не загрузились" }), {
      html: "<p>x</p>",
      warning: "Фото не загрузились",
    });
    assert.deepEqual(asPrintHtml({ base64: "AAA", fileName: "a.docx" }), { error: PRINT_FAILED });
    assert.deepEqual(asPrintHtml({ type: "single_html", html: "<p>роль</p>" }), { html: "<p>роль</p>" });
  });

  test("print: false — страница открыта, печать не вызывается; предупреждение — наружу", async () => {
    const { calls, written, win } = fakeWindow();
    const result = await printServerHtml(() => win, async () => ({ html: "<p>роль</p>", warning: "w" }), {
      print: false,
    });
    assert.deepEqual(result, { warning: "w" });
    assert.equal(written.at(-1), "<p>роль</p>");
    assert.deepEqual(calls, ["focus"]);
  });
});

describe("места печати", () => {
  test("window.open — только в общем помощнике", () => {
    const files = execSync('git ls-files "src/**/*.ts" "src/**/*.tsx"', { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((f) => !f.endsWith(".test.ts") && f !== "src/shared/lib/print-window.ts");
    const offenders = files.filter((f) => /window\.open\(/.test(source(f)));
    assert.deepEqual(offenders, []);
  });

  for (const file of PRINT_SITES) {
    test(`${path.basename(file)}: окно до первого await, через printExport`, () => {
      const text = source(file);
      assert.ok(text.includes("printExport("), "общий помощник");
      assert.ok(!text.includes("document.write"), "своей записи в окно нет");
      // Каждый путь печати: до ветки PDF — ни одного await, первый await в ветке — печать.
      const branches = [...text.matchAll(/if \(format === "pdf"\) \{/g)];
      if (branches.length === 0) {
        const fn = text.slice(text.indexOf("async function handleExportPdf()"));
        assert.ok(fn.indexOf("await") === fn.indexOf("await printExport("));
        return;
      }
      for (const branch of branches) {
        const before = text.slice(text.lastIndexOf("async () => {", branch.index), branch.index);
        assert.ok(!before.includes("await "), `${file}: await до окна`);
        const after = text.slice(branch.index);
        assert.equal(after.indexOf("await "), after.indexOf("await printExport("));
      }
    });
  }

  test("режиссёрский сценарий: раскладка сохраняется внутри загрузки (после открытия окна)", () => {
    const text = source("src/features/script/components/script-export-modals.tsx");
    const loader = text.slice(text.indexOf("const exportScript = async () => {"));
    assert.ok(loader.indexOf("await saveExportLayoutAction(") < loader.indexOf("await printExport(exportScript)"));
  });
});

describe("файлы выгрузок в сборке Vercel", () => {
  test("логотип явочного листа: прямой путь в коде и в outputFileTracingIncludes вызывного и отчёта смены", () => {
    const actions = source("src/features/day-docs/actions.ts");
    assert.ok(actions.includes(`path.join(process.cwd(), "public", "brand", "pelena-black.png")`));
    const config = source("next.config.ts");
    assert.match(config, /"\/\*\/projects\/\*\/call-sheets\/\*\*": \[[^\]]*"\.\/public\/brand\/pelena-black\.png"/);
    assert.match(config, /"\/\*\/projects\/\*\/reports\/\*\*": \["\.\/public\/brand\/pelena-black\.png"\]/);
  });
});
