import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseMediaUrls, parsePhotoUrls } from "@/features/scout/lib/media-urls";

describe("фото скаута", () => {
  test("загрузка файлом (путь /uploads/...) сохраняется", () => {
    assert.deepEqual(parsePhotoUrls("/uploads/p1/c.jpg"), [{ url: "/uploads/p1/c.jpg" }]);
  });

  test("полный адрес своего сайта сохраняется как путь, пустые строки пропущены", () => {
    const raw = [
      "https://pelenatoolz.vercel.app/uploads/p1/a.jpg",
      "",
      "  http://localhost:3000/uploads/p1/b.png  ",
    ].join("\n");
    assert.deepEqual(parsePhotoUrls(raw), [
      { url: "/uploads/p1/a.jpg" },
      { url: "/uploads/p1/b.png" },
    ]);
    assert.deepEqual(parsePhotoUrls(undefined), []);
    assert.deepEqual(parsePhotoUrls("  \n "), []);
  });

  test("внешний https сохраняется как есть", () => {
    assert.deepEqual(parsePhotoUrls("https://cdn.example.com/uploads/p1/d.jpg"), [
      { url: "https://cdn.example.com/uploads/p1/d.jpg" },
    ]);
  });

  test("мусор и javascript: отклоняются — весь список", () => {
    for (const bad of ["не адрес", "uploads/p1/a.jpg", "//evil.com/a.jpg", "javascript:alert(1)", "data:image/png;base64,AAAA"]) {
      assert.equal(parsePhotoUrls(`/uploads/p1/ok.jpg\n${bad}`), null, bad);
    }
  });

  test("видео не меняются", () => {
    assert.deepEqual(parseMediaUrls("https://pelenatoolz.vercel.app/uploads/p1/v.mp4"), [
      { url: "https://pelenatoolz.vercel.app/uploads/p1/v.mp4" },
    ]);
  });
});
