import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Permission } from "@/features/memberships/permissions";
import { canDeleteProjectFile, canReadProjectFile, projectFileHeaders } from "./file-access";

const can =
  (...allowed: Permission[]) =>
  (permission: Permission) =>
    allowed.includes(permission);

describe("чтение файла проекта", () => {
  test("закрытый файл открывает только право на договоры", () => {
    assert.equal(canReadProjectFile(can("contracts:read"), true), true);
    assert.equal(canReadProjectFile(can("cast:read", "project:read", "script:read"), true), false);
  });

  test("обычный файл открывают разделы проекта, а не договоры", () => {
    for (const permission of ["cast:read", "project:read", "script:read"] as const) {
      assert.equal(canReadProjectFile(can(permission), false), true);
    }
    assert.equal(canReadProjectFile(can("contracts:read"), false), false);
  });
});

describe("ответ с файлом проекта", () => {
  test("обычная картинка открывается на странице", () => {
    for (const type of ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]) {
      assert.match(projectFileHeaders(type, "a.png")["Content-Disposition"], /^inline/, type);
    }
  });

  test("всё остальное скачивается", () => {
    for (const type of [
      "text/html",
      "TEXT/HTML",
      "image/svg+xml",
      "IMAGE/PNG",
      "image/png, text/html",
      "application/pdf",
      "video/mp4",
      "application/xhtml+xml",
      "text/xml",
      "",
    ]) {
      assert.match(projectFileHeaders(type, "a")["Content-Disposition"], /^attachment/, type);
    }
  });

  test("тип браузера сохраняется только у картинок, видео и аудио", () => {
    for (const type of ["image/png", "video/mp4", "video/quicktime", "audio/mpeg"]) {
      assert.equal(projectFileHeaders(type, "a")["Content-Type"], type);
    }
    for (const type of [
      "text/javascript",
      "application/javascript",
      "text/html",
      "image/svg+xml",
      "application/pdf",
      "video/mp4, text/html",
      "VIDEO/MP4",
      "",
    ]) {
      assert.equal(projectFileHeaders(type, "a")["Content-Type"], "application/octet-stream", type);
    }
  });

  test("защитные заголовки есть всегда", () => {
    for (const type of ["image/png", "text/html"]) {
      const headers = projectFileHeaders(type, "a");
      assert.equal(headers["X-Content-Type-Options"], "nosniff");
      assert.match(headers["Content-Security-Policy"], /sandbox/);
    }
  });

  test("кириллица и кавычки в имени не ломают заголовок", () => {
    const value = projectFileHeaders("text/html", 'скан "1".html')["Content-Disposition"];
    assert.match(value, /filename\*=UTF-8''/);
    assert.ok(!/[\r\n]/.test(value));
    assert.equal(value.split('"').length, 3);
  });
});

describe("удаление файла проекта", () => {
  test("файл договора требует права менять договоры", () => {
    assert.equal(canDeleteProjectFile(can("script:write"), true), false);
    assert.equal(canDeleteProjectFile(can("contracts:write"), true), false);
    assert.equal(canDeleteProjectFile(can("script:write", "contracts:write"), true), true);
  });

  test("обычный файл удаляется как раньше", () => {
    assert.equal(canDeleteProjectFile(can("project:write"), false), true);
    assert.equal(canDeleteProjectFile(can("contracts:write"), false), false);
  });
});
