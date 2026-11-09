import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { DEFAULT_PREP_EVENT_TYPES } from "@/features/prep-calendar/lib/default-event-types";
import {
  isPrepEventColor,
  PREP_EVENT_COLORS,
  prepEventColorStyle,
} from "@/features/prep-calendar/lib/event-colors";

const css = readFileSync("src/app/globals.css", "utf8");
const lightStart = css.indexOf('[data-theme="light"] {');
const themes = {
  тёмная: css.slice(0, lightStart),
  светлая: css.slice(lightStart),
};

function hexVar(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  assert.ok(match, `нет переменной ${name}`);
  return match[1]!;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("цвета типов событий", () => {
  test("в обеих темах у каждого цвета есть переменные и контраст текста ≥ 4.5:1", () => {
    for (const [theme, block] of Object.entries(themes)) {
      for (const { key } of PREP_EVENT_COLORS) {
        const bg = hexVar(block, `--event-${key}-bg`);
        const fg = hexVar(block, `--event-${key}-fg`);
        hexVar(block, `--event-${key}-line`);
        assert.ok(contrast(fg, bg) >= 4.5, `${theme}, ${key}: ${contrast(fg, bg).toFixed(2)}`);
      }
    }
  });

  test("неизвестный ключ из базы показывается серым, чужая строка в стиль не попадает", () => {
    assert.equal(isPrepEventColor("url(evil)"), false);
    assert.equal(prepEventColorStyle("url(evil)").color, "var(--event-gray-fg)");
    assert.equal(prepEventColorStyle("blue").color, "var(--event-blue-fg)");
  });
});

describe("начальные типы", () => {
  const migration = readFileSync(
    "prisma/migrations/20261107120000_prep_calendar/migration.sql",
    "utf8",
  );

  test("список в коде совпадает со списком в миграции, цвета из набора", () => {
    const fromSql = [...migration.matchAll(/^\s+\('([^']+)', '([a-z]+)', (\d+)\),?$/gm)];
    assert.deepEqual(
      fromSql.map(([, name, color, order]) => ({ name, color, order: Number(order) })),
      DEFAULT_PREP_EVENT_TYPES.map(({ name, color }, order) => ({ name, color, order })),
    );
    for (const { color } of DEFAULT_PREP_EVENT_TYPES) assert.ok(isPrepEventColor(color));
  });

  test("в наборе все типы из задания", () => {
    assert.equal(DEFAULT_PREP_EVENT_TYPES.length, 10);
    assert.equal(new Set(DEFAULT_PREP_EVENT_TYPES.map((t) => t.name)).size, 10);
  });
});
