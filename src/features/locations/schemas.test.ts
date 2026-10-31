import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { locationPhotoSchema } from "@/features/locations/schemas";

describe("фото локации", () => {
  test("свой домен → путь сайта, чужой — как есть", () => {
    for (const [url, expected] of [
      ["https://pelenatoolz.vercel.app/uploads/p1/a.jpg", "/uploads/p1/a.jpg"],
      [" http://localhost:3000/uploads/p1/a.jpg ", "/uploads/p1/a.jpg"],
      ["https://cdn.example.com/uploads/p1/a.jpg", "https://cdn.example.com/uploads/p1/a.jpg"],
    ]) {
      const parsed = locationPhotoSchema.safeParse({ url });
      assert.ok(parsed.success, url);
      assert.equal(parsed.data.url, expected, url);
    }
  });

  test("не адрес — ошибка, как раньше", () => {
    assert.equal(locationPhotoSchema.safeParse({ url: "не адрес" }).success, false);
  });
});
