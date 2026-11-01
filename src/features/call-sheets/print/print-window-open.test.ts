import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  MEDEO_FONT_RELATIVE_PATH,
  medeoFontPath,
} from "@/features/call-sheets/print/medeo-font";
import {
  PRINT_FAILED,
  PRINT_POPUP_BLOCKED,
  printServerHtml,
} from "@/shared/lib/print-window";

/**
 * «Печать / PDF» вызывного на проде не открывала окно: (1) на Vercel шрифт искался через
 * `package.json` пакета, которого в сборке нет, — действие падало исключением, и меню молчало;
 * (2) окно открывалось после ответа сервера — блокировщик всплывающих окон.
 */

function source(relative: string) {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("шрифт листа в сборке Vercel", () => {
  test("в сборке только файл шрифта, без package.json пакета — путь всё равно находится", () => {
    // Копия того, что кладёт `outputFileTracingIncludes`: один файл, больше ничего.
    const root = mkdtempSync(path.join(os.tmpdir(), "medeo-trace-"));
    try {
      const target = path.join(root, ...MEDEO_FONT_RELATIVE_PATH.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(medeoFontPath(), target);
      assert.ok(!existsSync(path.join(root, "node_modules", "medeo-font", "package.json")));
      assert.equal(medeoFontPath(root), target);
      assert.ok(readFileSync(medeoFontPath(root)).byteLength > 10_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("путь в коде = путь в outputFileTracingIncludes: и у страницы вызывного, и у маршрута шрифта", () => {
    const config = source("next.config.ts").replaceAll("\r\n", "\n");
    const included = `"./${MEDEO_FONT_RELATIVE_PATH}"`;
    assert.ok(config.includes(`"/*/projects/*/call-sheets/**": [\n      ${included},`), "страница вызывного (там же действие печати)");
    assert.ok(config.includes(`"/api/fonts/**": [${included}]`), "маршрут шрифта");
    assert.ok(!source("src/features/call-sheets/print/medeo-font.ts").includes("createRequire"));
  });
});

describe("окно печати: сначала окно, потом сервер", () => {
  function fakeWindow() {
    const calls: string[] = [];
    const written: string[] = [];
    const win = {
      focus: () => calls.push("focus"),
      print: () => calls.push("print"),
      close: () => calls.push("close"),
      document: {
        images: [],
        write: (html: string) => written.push(html),
        close: () => calls.push("doc-close"),
      },
    };
    return { calls, written, win };
  }

  test("окно открывается синхронно — до запроса к серверу", async () => {
    const order: string[] = [];
    const { calls, written, win } = fakeWindow();
    const done = printServerHtml(
      () => {
        order.push("open");
        return win;
      },
      async () => {
        order.push("load");
        return { html: "<p>лист</p>" };
      },
    );
    // До первого `await` вызывающего окно уже открыто и в нём строка ожидания.
    assert.deepEqual(order, ["open", "load"]);
    assert.match(written[0], /Готовим лист к печати/);
    assert.ok(!/<script/i.test(written[0]));
    assert.deepEqual(await done, {});
    assert.equal(written[1], "<p>лист</p>");
    assert.deepEqual(calls, ["doc-close", "doc-close", "focus", "print"]);
  });

  test("блокировщик не дал окно — сервер не вызывается, сообщение", async () => {
    let loaded = false;
    const result = await printServerHtml(
      () => null,
      async () => {
        loaded = true;
        return { html: "x" };
      },
    );
    assert.deepEqual(result, { error: PRINT_POPUP_BLOCKED });
    assert.equal(loaded, false);
  });

  test("сервер вернул ошибку — окно закрывается, текст ошибки наружу", async () => {
    const { calls, win } = fakeWindow();
    const result = await printServerHtml(() => win, async () => ({ error: "Нет прав" }));
    assert.deepEqual(result, { error: "Нет прав" });
    assert.ok(calls.includes("close"));
    assert.ok(!calls.includes("print"));
  });

  test("действие упало исключением (500) — окно закрывается, сообщение вместо тишины", async () => {
    const { calls, win } = fakeWindow();
    const result = await printServerHtml(
      () => win,
      async () => {
        throw new Error("ENOENT MedeoSansVariable.woff2");
      },
    );
    assert.deepEqual(result, { error: PRINT_FAILED });
    assert.ok(calls.includes("close"));
  });

  test("вызывной: меню «Экспорт» и печать версии идут через printServerHtml, без await до открытия окна", () => {
    const client = source("src/features/call-sheets/components/call-sheet-print-client.ts");
    assert.match(
      client,
      /return printServerHtml\(\s*\(\) => window\.open\("", "_blank"\),\s*\(\) => getCallSheetPrintHtmlAction\(projectId, dayId, version\),\s*\);/,
    );
    const menu = source("src/features/day-docs/components/day-docs-export-menu.tsx");
    const menuPrint = menu.slice(menu.indexOf("async function printCallSheet()"));
    assert.equal(
      menuPrint.indexOf("await"),
      menuPrint.indexOf("await openCallSheetPrint("),
      "первый await в обработчике — сама печать",
    );
    const panel = source("src/features/call-sheets/components/call-sheet-status-panel.tsx");
    const panelPrint = panel.slice(panel.indexOf("async function exportVersion("));
    assert.equal(panelPrint.indexOf("await"), panelPrint.indexOf("await printCallSheet("));
  });

  test("действие печати: сбой сборки листа — ответ с ошибкой, а не исключение", () => {
    const action = source("src/features/call-sheets/print-actions.ts");
    assert.match(action, /try \{\s*return \{\s*html: buildCallSheetHtml\(/);
    assert.match(action, /catch \(error\) \{[\s\S]*return \{ error: PRINT_BUILD_FAILED \};/);
  });
});
