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
  test("картинки, PDF, видео и аудио открываются во вкладке", () => {
    for (const type of [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "video/mp4",
      "video/quicktime",
      "video/x-matroska",
      "audio/mpeg",
    ]) {
      const headers = projectFileHeaders(type, "a");
      assert.match(headers["Content-Disposition"], /^inline/, type);
      assert.equal(headers["Content-Type"], type);
    }
  });

  test("всё остальное скачивается как двоичный файл", () => {
    for (const type of [
      "text/html",
      "TEXT/HTML",
      "image/svg+xml",
      "IMAGE/PNG",
      "image/png, text/html",
      "application/xhtml+xml",
      "text/xml",
      "text/javascript",
      "application/javascript",
      "video/x+xml",
      "audio/x+xml",
      "video/mp4, text/html",
      "VIDEO/MP4",
      "application/pdf; x=1",
      "",
    ]) {
      const headers = projectFileHeaders(type, "a");
      assert.match(headers["Content-Disposition"], /^attachment/, type);
      assert.equal(headers["Content-Type"], "application/octet-stream", type);
    }
  });

  test("защитные заголовки есть всегда", () => {
    for (const type of ["image/png", "application/pdf", "text/html"]) {
      const headers = projectFileHeaders(type, "a");
      assert.equal(headers["X-Content-Type-Options"], "nosniff");
      assert.match(headers["Content-Security-Policy"], /sandbox/);
    }
    const player = projectFileHeaders("video/mp4", "a");
    assert.equal(player["X-Content-Type-Options"], "nosniff");
    assert.equal(player["Content-Security-Policy"], "default-src 'none'; media-src 'self'; sandbox allow-same-origin");
    assert.ok(!player["Content-Security-Policy"].includes("allow-scripts"));
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
