import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { stripHtml } from "@/features/screenplay/lib/plain-text";
import {
  blockFromEditorHtml,
  parseBlockHtml,
  safeBlockHtml,
  safeColor,
} from "@/features/screenplay/lib/safe-block-html";

// Пункт 4 аудита (минимум, шаг 7 волны 4): блок показывается из узлов, а не через innerHTML.

describe("safe-block-html: опасное не проходит", () => {
  const cases: [string, string][] = [
    ['<img src=x onerror="alert(1)">текст', "текст"],
    ["<script>alert(1)</script>после", "после"],
    ["<style>body{display:none}</style>после", "после"],
    ['<b onclick="alert(1)">жир</b>', "<b>жир</b>"],
    ['<a href="javascript:alert(1)">ссылка</a>', "ссылка"],
    ['<iframe src="https://example.com"></iframe>ок', "ок"],
    ['<svg onload="alert(1)"><circle/></svg>ок', "ок"],
    ['<span style="color: red; background: url(javascript:alert(1))">т</span>', "<span>т</span>"],
    ['<span style="color: expression(alert(1))">т</span>', "<span>т</span>"],
    ['<font color="#ff0000" onmouseover="alert(1)">т</font>', '<font color="#ff0000">т</font>'],
    ['<font color="red;x:expression(1)">т</font>', "<font>т</font>"],
    ["<!-- <img onerror=alert(1)> -->т", "т"],
    ["<div><p>абзац</p></div>", "<div><p>абзац</p></div>"],
  ];
  for (const [input, expected] of cases) {
    test(input, () => assert.equal(safeBlockHtml("", input), expected));
  }

  test("без contentHtml — текст как текст, теги не разбираются", () => {
    assert.equal(safeBlockHtml("<img src=x onerror=alert(1)>", null), "&lt;img src=x onerror=alert(1)&gt;");
    assert.equal(safeBlockHtml("А & Б", ""), "А &amp; Б");
  });

  test("цвет — только hex и rgb()", () => {
    for (const ok of ["#f00", "#FF0000", "rgb(1, 2, 3)", "rgba(255,255,0,0.5)", "rgba(0, 0, 0, 1)"]) {
      assert.equal(safeColor(ok), ok);
    }
    for (const bad of ["red", "#ff00", "rgb(1,2)", "url(x)", "rgb(1,2,3);color:red", "var(--x)", "hsl(0,0%,0%)"]) {
      assert.equal(safeColor(bad), undefined, bad);
    }
  });

  test("в дереве нет ничего, кроме разрешённых тегов и текста", () => {
    const tree = parseBlockHtml('<table><tr><td onclick="x"><b>т</b></td></tr></table><object>o</object>');
    assert.deepEqual(tree, [{ tag: "b", colors: {}, children: [{ text: "т" }] }]);
  });
});

describe("safe-block-html: форматирование панели сохраняется", () => {
  // Что даёт панель форматирования в Chrome (execCommand): b, i, u, strike, font color, span фона.
  const formatted =
    '<b>Жир</b> <i>курсив</i> <u>подчёрк</u> <strike>зачёрк</strike> ' +
    '<font color="#ff0000">цвет</font> <span style="background-color: rgb(255, 255, 0);">фон</span><br>строка';

  test("показ не меняет разрешённую разметку", () => {
    assert.equal(safeBlockHtml("", formatted), formatted);
    // Повторно — то же самое.
    assert.equal(safeBlockHtml("", safeBlockHtml("", formatted)), formatted);
  });

  test("правка блока не теряет contentHtml", () => {
    const content = stripHtml(formatted);
    // Блок показан в редакторе, пользователь дописал текст в конец — так выглядит innerHTML.
    const shown = safeBlockHtml(content, formatted);
    const edited = blockFromEditorHtml(`${shown} ещё`);
    assert.ok(edited.contentHtml, "contentHtml потерян");
    for (const tag of ["<b>", "<i>", "<u>", "<strike>", '<font color="#ff0000">', "background-color"]) {
      assert.ok(edited.contentHtml.includes(tag), tag);
    }
    assert.equal(edited.content, `${content} ещё`);
  });

  test("правка блока без разметки — contentHtml остаётся пустым", () => {
    const shown = safeBlockHtml("Просто текст", null);
    assert.deepEqual(blockFromEditorHtml(`${shown}!`), { content: "Просто текст!", contentHtml: null });
  });
});
