import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSceneSchema } from "@/features/script/schemas";

describe("createSceneSchema", () => {
  test("scriptContent от браузера отбрасывается, остальное сохраняется", () => {
    const parsed = createSceneSchema.safeParse({
      number: "1",
      title: "ТЕСТ",
      scriptContent: "ТЕСТ подмена текста",
    });
    assert.equal(parsed.success, true);
    assert.ok(parsed.success);
    assert.equal("scriptContent" in parsed.data, false);
    assert.equal(parsed.data.number, "1");
    assert.equal(parsed.data.title, "ТЕСТ");
  });

  test("слишком длинный scriptContent не ломает разбор", () => {
    const parsed = createSceneSchema.safeParse({
      number: "1",
      scriptContent: "х".repeat(200_000),
    });
    assert.equal(parsed.success, true);
    assert.ok(parsed.success);
    assert.equal("scriptContent" in parsed.data, false);
  });
});
