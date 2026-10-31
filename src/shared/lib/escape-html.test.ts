import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  escapeHtml,
  isHttpUrl,
  isSitePath,
  PRINT_HTML_CSP_META,
  safePrintUrl,
} from "@/shared/lib/escape-html";

describe("escapeHtml", () => {
  test("все пять символов", () => {
    assert.equal(escapeHtml("&"), "&amp;");
    assert.equal(escapeHtml("<"), "&lt;");
    assert.equal(escapeHtml(">"), "&gt;");
    assert.equal(escapeHtml('"'), "&quot;");
    assert.equal(escapeHtml("'"), "&#39;");
    assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });

  test("опасные строки становятся текстом", () => {
    assert.equal(escapeHtml("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
    assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
    assert.equal(escapeHtml('" onmouseover="alert(1)'), "&quot; onmouseover=&quot;alert(1)");
    assert.equal(escapeHtml("' onmouseover='alert(1)"), "&#39; onmouseover=&#39;alert(1)");
  });

  test("обычный текст не меняется, «&» — один раз", () => {
    assert.equal(escapeHtml("Иванов Иван, 12.03"), "Иванов Иван, 12.03");
    assert.equal(escapeHtml("А & Б"), "А &amp; Б");
    assert.equal(escapeHtml("&amp;"), "&amp;amp;");
  });
});

describe("safePrintUrl", () => {
  test("http(s) и пути сайта проходят", () => {
    assert.equal(safePrintUrl("https://example.com/a.png"), "https://example.com/a.png");
    assert.equal(safePrintUrl("http://example.com"), "http://example.com");
    assert.equal(safePrintUrl("  https://example.com/x  "), "https://example.com/x");
    assert.equal(safePrintUrl("/uploads/p1/photo.jpg"), "/uploads/p1/photo.jpg");
    assert.equal(safePrintUrl("/ru/projects/p1/preproduction/casting/c1"), "/ru/projects/p1/preproduction/casting/c1");
  });

  test("остальное отбрасывается", () => {
    for (const url of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "java\tscript:alert(1)",
      " javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "//evil.com/x.png",
      "/\\evil.com/x.png",
      "@evil.com/x.png",
      "evil.com/x.png",
      "x",
      "",
      "   ",
      null,
      undefined,
    ]) {
      assert.equal(safePrintUrl(url), null, String(url));
    }
  });

  test("isHttpUrl и isSitePath по отдельности", () => {
    assert.equal(isHttpUrl("https://example.com"), true);
    assert.equal(isHttpUrl("/uploads/a.png"), false);
    assert.equal(isHttpUrl("ftp://example.com"), false);
    assert.equal(isSitePath("/uploads/a.png"), true);
    assert.equal(isSitePath("https://example.com"), false);
    assert.equal(isSitePath("//evil.com"), false);
  });
});

describe("PRINT_HTML_CSP_META", () => {
  test("запрещает скрипты, плагины и base", () => {
    assert.match(PRINT_HTML_CSP_META, /script-src 'none'; object-src 'none'; base-uri 'none'/);
  });
});
