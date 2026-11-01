import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

/** Встроенные страницы (лист вызывного) не должны получать право запускать скрипты. */

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(tsx?|jsx?|mjs)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });
}

const files = [...sourceFiles(path.join(ROOT, "src")), ...sourceFiles(path.join(ROOT, "scripts")), path.join(ROOT, "next.config.ts")];

/** Код без комментариев: в них слова «allow-scripts» и «<iframe» встречаются в пояснениях. */
function code(file: string) {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function rel(file: string) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

describe("iframe и песочница", () => {
  test("iframe листа вызывного: sandbox без allow-scripts", () => {
    const preview = code(path.join(ROOT, "src/features/call-sheets/components/call-sheet-preview.tsx"));
    const iframes = preview.match(/<iframe\b[\s\S]*?\/>/g) ?? [];
    assert.equal(iframes.length, 1);
    const sandbox = iframes[0]!.match(/sandbox="([^"]*)"/)?.[1];
    assert.equal(sandbox, "allow-same-origin", "sandbox задан строкой и без скриптов");
    assert.ok(!/allow-scripts/.test(iframes[0]!));
  });

  test("ни в одном sandbox проекта нет allow-scripts", () => {
    let sandboxed = 0;
    for (const file of files) {
      const text = code(file);
      for (const tag of text.match(/<iframe\b[\s\S]*?>/g) ?? []) {
        // Плеер проб (видео с внешних сайтов) встраивается без sandbox — ему нужны их скрипты.
        if (!/\bsandbox=/.test(tag)) continue;
        sandboxed += 1;
        assert.doesNotMatch(tag, /allow-scripts/, `${rel(file)}: allow-scripts`);
      }
    }
    assert.ok(sandboxed >= 1, "iframe листа найден");
  });

  test("allow-scripts вместе с allow-same-origin не встречаются нигде в проекте", () => {
    for (const file of files) {
      const text = code(file);
      assert.ok(
        !(text.includes("allow-scripts") && text.includes("allow-same-origin")),
        rel(file),
      );
      assert.ok(!text.includes("allow-scripts"), `${rel(file)}: allow-scripts`);
    }
  });
});
