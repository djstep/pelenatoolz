import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { needsPersonalDataConsent, PERSONAL_DATA_POLICY_VERSION } from "./personal-data-consent";
import { policyParts, PRIVACY_POLICY_TEXT } from "./privacy-policy-text";

describe("согласие на обработку данных", () => {
  test("новая редакция не нужна, если принята текущая", () => {
    assert.equal(needsPersonalDataConsent(PERSONAL_DATA_POLICY_VERSION), false);
  });

  test("черновое согласие, старая редакция и отсутствие согласия требуют принятия", () => {
    for (const version of ["draft-2026-11-04", "2020-01-01", null, undefined, ""]) {
      assert.equal(needsPersonalDataConsent(version), true, String(version));
    }
  });
});

describe("текст политики", () => {
  const file = readFileSync(path.join(process.cwd(), "docs", "legal", "Политика_ПДн_PELENA.txt"), "utf8");

  test("на сайте ровно текст из файла", () => {
    assert.equal(PRIVACY_POLICY_TEXT, file);
  });

  test("редакция политики совпадает с версией согласия", () => {
    const [year, month, day] = PERSONAL_DATA_POLICY_VERSION.split("-");
    assert.ok(file.includes(`Редакция от ${day}.${month}.${year}`));
  });

  test("разбор на заголовки не теряет ни одной строки", () => {
    const parts = policyParts(PRIVACY_POLICY_TEXT);
    const lines = file.split("\n").filter((line) => line.trim());
    assert.deepEqual(parts.map((part) => part.text), lines);
    assert.equal(parts[0]!.kind, "title");
    const headings = parts.filter((part) => part.kind === "heading").map((part) => part.text);
    assert.equal(headings.length, 9);
    assert.equal(headings[4], "5.Меры по защите персональных данных.");
    assert.equal(headings[8], "9. Заключительные положения");
  });
});
