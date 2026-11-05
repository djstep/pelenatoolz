import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clearEmptied } from "@/shared/lib/cleared-fields";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("clearEmptied", () => {
  const parsed = { name: "Имя", notes: undefined as string | undefined };

  it("пустое поле — очистить", () => {
    const result = clearEmptied(parsed, form({ name: "Имя", notes: "" }), ["notes"]);
    assert.equal(result.notes, null);
  });

  it("поле из пробелов — тоже пустое", () => {
    const result = clearEmptied(parsed, form({ notes: "   " }), ["notes"]);
    assert.equal(result.notes, null);
  });

  it("поля нет в форме — не менять", () => {
    const result = clearEmptied(parsed, form({ name: "Имя" }), ["notes"]);
    assert.equal(result.notes, undefined);
  });

  it("заполненное поле остаётся как есть", () => {
    const result = clearEmptied({ notes: "Текст" }, form({ notes: "Текст" }), ["notes"]);
    assert.equal(result.notes, "Текст");
  });

  it("поле вне списка не трогается", () => {
    const result = clearEmptied(parsed, form({ name: "" }), ["notes"]);
    assert.equal(result.name, "Имя");
  });
});
