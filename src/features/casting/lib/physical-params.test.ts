import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customPhysicalParamKeys,
  parsePhysicalParams,
} from "@/features/casting/lib/physical-params";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("parsePhysicalParams", () => {
  const saved = { height: "180", тату: "дракон" };

  it("свой параметр в форме сохраняется", () => {
    const params = parsePhysicalParams(form({ phys_height: "180", phys_тату: "дракон" }), saved);
    assert.deepEqual(params, saved);
  });

  it("новое значение своего параметра", () => {
    const params = parsePhysicalParams(form({ phys_height: "180", phys_тату: "якорь" }), saved);
    assert.equal(params.тату, "якорь");
  });

  it("стёртый параметр убирается", () => {
    const params = parsePhysicalParams(form({ phys_height: "", phys_тату: "" }), saved);
    assert.deepEqual(params, {});
  });

  it("параметра нет в форме — он остаётся", () => {
    const params = parsePhysicalParams(form({ phys_height: "190" }), saved);
    assert.deepEqual(params, { height: "190", тату: "дракон" });
  });

  it("«Другое» добавляет параметр и не попадает в данные как служебное", () => {
    const params = parsePhysicalParams(
      form({ phys_custom_key: "шрам", phys_custom_value: "левая бровь" }),
    );
    assert.deepEqual(params, { шрам: "левая бровь" });
  });

  it("«Другое» без значения ничего не добавляет", () => {
    const params = parsePhysicalParams(form({ phys_custom_key: "шрам", phys_custom_value: "" }));
    assert.deepEqual(params, {});
  });

  it("служебные ключи из старых записей не сохраняются", () => {
    const params = parsePhysicalParams(form({ phys_тату: "дракон" }), {
      тату: "дракон",
      custom_key: "тату",
      custom_value: "дракон",
    });
    assert.deepEqual(params, { тату: "дракон" });
  });
});

describe("customPhysicalParamKeys", () => {
  it("только свои параметры", () => {
    const keys = customPhysicalParamKeys({ height: "180", тату: "дракон", custom_key: "тату" });
    assert.deepEqual(keys, ["тату"]);
  });

  it("не объект — параметров нет", () => {
    assert.deepEqual(customPhysicalParamKeys(null), []);
    assert.deepEqual(customPhysicalParamKeys(["тату"]), []);
  });
});
