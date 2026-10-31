import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseMediaUrls, parsePhotoUrls } from "@/features/scout/lib/media-urls";

describe("фото скаута", () => {
  test("свой домен → путь сайта, чужие и пути — как есть, пустые строки пропущены", () => {
    const raw = [
      "https://pelenatoolz.vercel.app/uploads/p1/a.jpg",
      "",
      "  http://localhost:3000/uploads/p1/b.png  ",
      "/uploads/p1/c.jpg",
      "https://cdn.example.com/uploads/p1/d.jpg",
    ].join("\n");
    assert.deepEqual(parsePhotoUrls(raw), [
      { url: "/uploads/p1/a.jpg" },
      { url: "/uploads/p1/b.png" },
      { url: "/uploads/p1/c.jpg" },
      { url: "https://cdn.example.com/uploads/p1/d.jpg" },
    ]);
    assert.deepEqual(parsePhotoUrls(undefined), []);
    assert.deepEqual(parsePhotoUrls("  \n "), []);
  });

  test("видео не меняются", () => {
    assert.deepEqual(parseMediaUrls("https://pelenatoolz.vercel.app/uploads/p1/v.mp4"), [
      { url: "https://pelenatoolz.vercel.app/uploads/p1/v.mp4" },
    ]);
  });
});
