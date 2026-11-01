import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { locationPhotoSchema } from "@/features/locations/schemas";

describe("фото локации", () => {
  function saved(url: string) {
    const parsed = locationPhotoSchema.safeParse({ url });
    return parsed.success ? parsed.data.url : null;
  }

  test("загрузка файлом (путь /uploads/...) сохраняется", () => {
    assert.equal(saved("/uploads/p1/a.jpg"), "/uploads/p1/a.jpg");
  });

  test("полный адрес своего сайта сохраняется как путь", () => {
    assert.equal(saved("https://pelenatoolz.vercel.app/uploads/p1/a.jpg"), "/uploads/p1/a.jpg");
    assert.equal(saved(" http://localhost:3000/uploads/p1/a.jpg "), "/uploads/p1/a.jpg");
  });

  test("внешний https сохраняется как есть", () => {
    assert.equal(saved("https://cdn.example.com/uploads/p1/a.jpg"), "https://cdn.example.com/uploads/p1/a.jpg");
  });

  test("мусор и javascript: отклоняются", () => {
    for (const url of ["", "не адрес", "uploads/p1/a.jpg", "//evil.com/a.jpg", "javascript:alert(1)", "data:image/png;base64,AAAA"]) {
      assert.equal(saved(url), null, url);
    }
  });
});
