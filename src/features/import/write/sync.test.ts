import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import type { ScriptBlockType } from "@prisma/client";
import { classifyParagraphs } from "@/features/import/normalize/block-types";
import { readDocxParagraphs } from "@/features/import/normalize/docx-paragraphs";
import {
  normalizeScript,
  QUESTION_TYPES,
  type ExistingRecords,
} from "@/features/import/normalize/normalize-script";
import { contentHash, headingKey } from "@/features/import/normalize/scene-match";
import { typingFromVersionBlocks } from "@/features/import/write/version-typing";
import { buildSlugline } from "@/features/screenplay/lib/slugline";

// Синхронизация версии с либретто (шаг 6б) и шапка из либретто без подстановок.
// Новые ожидания — решения владельца к 6б, не из утверждённой таблицы.

const FIXTURES = path.join(process.cwd(), "docs", "tasks", "fixtures", "scripts");

type Block = { type: ScriptBlockType; content: string };

function syncRun(blocks: Block[], existing: ExistingRecords, answers = {}) {
  return normalizeScript(typingFromVersionBlocks(blocks), answers, { existing, sync: true });
}

describe("блоки версии как вход нормализации", () => {
  test("тип — как в версии, титр — действие, служебные блоки не читаются, индекс — номер блока", () => {
    const typing = typingFromVersionBlocks([
      { type: "ACTION", content: "До первой сцены" },
      { type: "SLUGLINE", content: "1. ИНТ. КУХНЯ — ДЕНЬ" },
      { type: "SUPER", content: "Москва, 1999" },
      { type: "BONEYARD", content: "Скрытый текст" },
      { type: "ACTION", content: "   " },
      { type: "CHARACTER", content: "МАМА" },
    ]);
    assert.deepEqual(
      typing.blocks.map((b) => [b.paragraphIndex, b.type, b.beforeFirstScene]),
      [
        [0, "ACTION", true],
        [1, "SLUGLINE", false],
        [2, "ACTION", false],
        [5, "CHARACTER", false],
      ],
    );
    assert.deepEqual(typing.conflicts, []);
  });
});

describe("режим синхронизации: предложенный ответ не пишет в либретто", () => {
  const empty: ExistingRecords = { characters: [], locations: [], scenes: [] };

  test("«режим от предыдущей» — по умолчанию «не менять», режим не ставится", () => {
    const blocks: Block[] = [
      { type: "SLUGLINE", content: "1. ИНТ. КУХНЯ — ДЕНЬ" },
      { type: "ACTION", content: "Раз." },
      { type: "SLUGLINE", content: "2. ИНТ. КУХНЯ — ПОЗЖЕ" },
      { type: "ACTION", content: "Два." },
    ];
    const result = syncRun(blocks, empty);
    const q = result.questions.find((x) => x.type === QUESTION_TYPES.timeFromPrevious);
    assert.ok(q);
    assert.equal(q.suggested, "none");
    assert.equal(result.scenes[1]!.dayNight, null);
    // При импорте файла — как раньше: режим предыдущей.
    const imported = normalizeScript(typingFromVersionBlocks(blocks), {}, { existing: empty });
    assert.equal(imported.scenes[1]!.dayNight, "DAY");
  });

  test("номера новых сцен — только ответом: нумерация и «номер занят» обязательные", () => {
    const blocks: Block[] = [
      { type: "SLUGLINE", content: "ИНТ. КУХНЯ — ДЕНЬ" },
      { type: "ACTION", content: "Раз." },
      { type: "SLUGLINE", content: "НАТ. ДВОР — НОЧЬ" },
      { type: "ACTION", content: "Два." },
    ];
    const result = syncRun(blocks, empty);
    const numbering = result.questions.find((x) => x.type === QUESTION_TYPES.numberAll);
    assert.ok(numbering?.required);
    const taken = syncRun(blocks, empty, { "нумерация:подряд": "keep" }).questions.filter(
      (x) => x.type === QUESTION_TYPES.numberTaken,
    );
    assert.equal(taken.length, 2);
    assert.ok(taken.every((x) => x.required));
  });

  test("«нет в строке Персонажи» не задаётся: меняет только текст версии", () => {
    const blocks: Block[] = [
      { type: "SLUGLINE", content: "1. ИНТ. КУХНЯ — ДЕНЬ" },
      { type: "SCENE_CAST", content: "Персонажи: МАМА" },
      { type: "CHARACTER", content: "ПАПА" },
      { type: "DIALOGUE", content: "Привет." },
    ];
    const imported = normalizeScript(typingFromVersionBlocks(blocks), {}, { existing: empty });
    assert.ok(imported.questions.some((x) => x.type === QUESTION_TYPES.castMissing));
    const result = syncRun(blocks, empty);
    assert.ok(!result.questions.some((x) => x.type === QUESTION_TYPES.castMissing));
    // Связи — те же: говорящий ПАПА и МАМА из строки.
    assert.deepEqual([...result.scenes[0]!.characters].sort(), ["МАМА", "ПАПА"]);
  });

  test("ddct: версия после импорта → синхронизация — все сцены через шапки этой версии", () => {
    const imported = normalizeScript(
      classifyParagraphs(readDocxParagraphs(readFileSync(path.join(FIXTURES, "ddct.docx")))),
    );
    const blocks: Block[] = imported.blocks.map((b) => ({ type: b.type, content: b.text }));
    const sluglines = blocks.flatMap((b, i) => (b.type === "SLUGLINE" ? [i] : []));
    const existing: ExistingRecords = {
      characters: [],
      locations: [],
      scenes: sluglines.map((_, n) => ({
        id: `s${n}`,
        number: String(n + 1),
        heading: blocks[sluglines[n]!]!.content,
        intExt: null,
        dayNight: null,
        cut: false,
        characterIds: [],
        locationIds: [],
        contentHash: contentHash(""),
        shootDays: [],
        reportFacts: 0,
      })),
      versionScenes: sluglines.map((i, n) => ({
        sceneId: `s${n}`,
        number: String(n + 1),
        key: headingKey(blocks[i]!.content),
      })),
    };
    const result = syncRun(blocks, existing);
    assert.equal(result.sceneMatches.length, 36);
    assert.ok(result.sceneMatches.every((m) => m.by === "version"));
    assert.deepEqual(
      result.sceneMatches.map((m) => m.existingId),
      sluglines.map((_, n) => `s${n}`),
    );
  });
});

describe("шапка из либретто: пустое поле — пусто в шапке", () => {
  const base = { episodeNumber: 0, number: "1", postfix: "" };

  test("ничего не подставляется", () => {
    assert.equal(buildSlugline(base), "1.");
    assert.equal(buildSlugline({ ...base, location: "ДОМ" }), "1. ДОМ");
    assert.equal(buildSlugline({ ...base, intExt: "INT" }), "1. ИНТ.");
    assert.equal(buildSlugline({ ...base, dayNight: "NIGHT", location: "ДОМ" }), "1. ДОМ – НОЧЬ");
  });

  test("заполненные поля — как раньше", () => {
    assert.equal(
      buildSlugline({ ...base, postfix: "А", intExt: "EXT", location: "ДВОР", dayNight: "DAY" }),
      "1А. НАТ. ДВОР – ДЕНЬ",
    );
  });
});
