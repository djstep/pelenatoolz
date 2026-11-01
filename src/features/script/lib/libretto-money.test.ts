import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

/**
 * Либретто, карточка сцены и сценарий (`listScenes`, `getSceneForEdit`) уходят в браузер любой
 * роли с «Сцены: просмотр». Устаревшие цены ресурсов сцены (`SceneResource.unitPrice` / `total`)
 * нигде не показываются — в выборку они не попадают (приёмка: роль без финансов видела их
 * в HTML и `?_rsc` либретто).
 */

function source(relative: string) {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("ресурсы сцены без цен", () => {
  test("выборки либретто — списком полей, без unitPrice и total", () => {
    const queries = source("src/features/script/queries.ts");
    const select = queries.match(/LIBRETTO_SCENE_RESOURCE_SELECT = selectFields\(\[([^\]]+)\]\)/)?.[1];
    assert.ok(select, "список полей ресурса сцены");
    assert.deepEqual(
      select.split(",").map((s) => s.trim().replaceAll('"', "")),
      ["id", "sceneId", "category", "name", "quantity"],
    );
    assert.ok(!/resources: true/.test(queries), "ресурсы сцены не берутся целиком");
    assert.equal(queries.match(/resources: \{ select: LIBRETTO_SCENE_RESOURCE_SELECT \}/g)?.length, 2);
  });

  test("форма сцены цену ресурса не ждёт и не выводит", () => {
    const form = source("src/features/script/components/scene-form-fields.tsx");
    assert.ok(!form.includes("unitPrice"));
  });
});
