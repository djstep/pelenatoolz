import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { auditionDraftProblem, type AuditionDraftState } from "./audition-draft";

const draft = (patch: Partial<AuditionDraftState>): AuditionDraftState => ({
  uploadStatus: "idle",
  externalUrl: "",
  date: "2026-11-07",
  ...patch,
});

describe("обязательные поля пробы", () => {
  test("файл без ссылки и ссылка без файла — можно сохранять", () => {
    assert.equal(auditionDraftProblem(draft({ videoFileId: "f1", uploadStatus: "done" })), null);
    assert.equal(auditionDraftProblem(draft({ externalUrl: "https://example.com/a" })), null);
  });

  test("без файла и ссылки — понятный отказ", () => {
    assert.equal(auditionDraftProblem(draft({})), "Выберите файл или укажите ссылку");
    assert.equal(auditionDraftProblem(draft({ externalUrl: "   " })), "Выберите файл или укажите ссылку");
  });

  test("файл не загрузился — видна причина", () => {
    const problem = auditionDraftProblem(draft({ uploadStatus: "error", uploadError: "Максимум 512 МБ на файл" }));
    assert.match(problem ?? "", /Файл не загрузился: Максимум 512 МБ на файл/);
  });

  test("не загрузился, но есть ссылка — можно сохранять", () => {
    const state = draft({ uploadStatus: "error", uploadError: "x", externalUrl: "https://example.com/a" });
    assert.equal(auditionDraftProblem(state), null);
  });

  test("идёт загрузка — просьба подождать", () => {
    assert.match(auditionDraftProblem(draft({ uploadStatus: "uploading" })) ?? "", /Дождитесь/);
  });

  test("без даты — отказ", () => {
    const state = draft({ videoFileId: "f1", uploadStatus: "done", date: "" });
    assert.equal(auditionDraftProblem(state), "Укажите дату съёмки пробы");
  });
});
