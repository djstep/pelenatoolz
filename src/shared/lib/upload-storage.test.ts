import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { uploadContentType, uploadFilePath } from "./upload-storage";

describe("адрес загруженной картинки", () => {
  test("тип берётся из имени", () => {
    assert.equal(uploadContentType("a_1-B.jpg"), "image/jpeg");
    assert.equal(uploadContentType("a.webp"), "image/webp");
  });

  test("имя, которое загрузка не создаёт, не проходит", () => {
    for (const name of ["a.svg", "a.html", "a.png.html", "../a.png", "a/b.png", "a.PNG", ".png", ""]) {
      assert.equal(uploadContentType(name), null, name);
      assert.equal(uploadFilePath("/data", "p1", name), null, name);
    }
  });

  test("путь остаётся внутри папки проекта", () => {
    assert.equal(uploadFilePath("/data", "p1", "a.png"), path.join("/data", "p1", "a.png"));
    for (const id of ["..", "../p2", "p1/p2", ""]) {
      assert.equal(uploadFilePath("/data", id, "a.png"), null, id);
    }
  });
});
