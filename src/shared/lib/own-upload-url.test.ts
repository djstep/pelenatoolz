import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { toOwnUploadPath } from "@/shared/lib/own-upload-url";

describe("toOwnUploadPath", () => {
  const saved = { APP_URL: process.env.APP_URL, NEXTAUTH_URL: process.env.NEXTAUTH_URL };

  beforeEach(() => {
    process.env.APP_URL = "https://pelena.example.ru/";
    delete process.env.NEXTAUTH_URL;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("путь сайта — как есть (без пробелов по краям)", () => {
    assert.equal(toOwnUploadPath("/uploads/p1/a.jpg"), "/uploads/p1/a.jpg");
    assert.equal(toOwnUploadPath("  /uploads/p1/a.jpg "), "/uploads/p1/a.jpg");
  });

  test("свой домен со своей загрузкой → путь сайта", () => {
    for (const url of [
      "https://pelena.example.ru/uploads/p1/a.jpg",
      "https://PELENA.example.ru/uploads/p1/a.jpg",
      "https://pelenatoolz.vercel.app/uploads/cmvusgbx60001dwlku4oylgct/BxKe6OMrcSd_wENyDb_4x.jpg",
      "https://pelenatoolz-git-feat-x.vercel.app/uploads/p1/a.jpg",
      "http://localhost:3000/uploads/p1/a.jpg",
      "http://127.0.0.1:3000/uploads/p1/a.jpg",
      "http://[::1]:3000/uploads/p1/a.jpg",
      "https://pelena.example.ru/uploads/p1/a.jpg?v=2#x",
    ]) {
      const expected = url.includes("cmvusgbx")
        ? "/uploads/cmvusgbx60001dwlku4oylgct/BxKe6OMrcSd_wENyDb_4x.jpg"
        : "/uploads/p1/a.jpg";
      assert.equal(toOwnUploadPath(url), expected, url);
    }
  });

  test("домен из NEXTAUTH_URL тоже свой", () => {
    delete process.env.APP_URL;
    process.env.NEXTAUTH_URL = "https://auth.pelena.example.ru";
    assert.equal(toOwnUploadPath("https://auth.pelena.example.ru/uploads/p1/a.jpg"), "/uploads/p1/a.jpg");
    assert.equal(
      toOwnUploadPath("https://pelena.example.ru/uploads/p1/a.jpg"),
      "https://pelena.example.ru/uploads/p1/a.jpg",
    );
  });

  test("чужой домен — без изменений", () => {
    for (const url of [
      "https://cdn.example.com/uploads/p1/a.jpg",
      "https://pelena.example.ru.evil.com/uploads/p1/a.jpg",
      "https://vercel.app.evil.com/uploads/p1/a.jpg",
      "https://evil.com/?u=https://pelena.example.ru/uploads/p1/a.jpg",
      "https://kinopoisk.ru/images/actor.jpg",
    ]) {
      assert.equal(toOwnUploadPath(url), url, url);
    }
  });

  test("свой домен, но не загрузка — без изменений", () => {
    for (const url of [
      "https://pelena.example.ru/ru/projects/p1",
      "https://pelena.example.ru/uploads",
      "https://pelena.example.ru/uploads/../api/x",
      "http://localhost:3000/favicon.ico",
    ]) {
      assert.equal(toOwnUploadPath(url), url, url);
    }
  });

  test("не http(s) и мусор — без изменений", () => {
    for (const url of [
      "javascript:alert(1)",
      "ftp://localhost/uploads/p1/a.jpg",
      "//pelena.example.ru/uploads/p1/a.jpg",
      "uploads/p1/a.jpg",
      "",
    ]) {
      assert.equal(toOwnUploadPath(url), url, url);
    }
  });

  test("неверный APP_URL не ломает разбор", () => {
    process.env.APP_URL = "не адрес";
    assert.equal(toOwnUploadPath("https://cdn.example.com/a.jpg"), "https://cdn.example.com/a.jpg");
    assert.equal(toOwnUploadPath("http://localhost/uploads/p1/a.jpg"), "/uploads/p1/a.jpg");
  });
});
