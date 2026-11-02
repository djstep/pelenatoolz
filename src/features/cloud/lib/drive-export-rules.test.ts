import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  callSheetDriveFileName,
  defaultDriveExportVersion,
  driveExportDoneText,
  DRIVE_EXPORT_BAD_INPUT,
  formatDriveDate,
  googleProjectFolderName,
  parseDriveExportInput,
  yandexProjectFolderName,
} from "@/features/cloud/lib/drive-export-rules";

// День съёмки хранится полночью по поясу проекта: 11.09.2026 00:00 МСК = 10.09 21:00 UTC.
const DAY = { dayNumber: 12, date: new Date("2026-09-10T21:00:00.000Z") };

describe("имя файла на диске", () => {
  test("дата — по поясу проекта, а не по UTC", () => {
    assert.equal(formatDriveDate(DAY.date, "Europe/Moscow"), "11.09.2026");
    assert.equal(formatDriveDate(DAY.date, "UTC"), "10.09.2026");
    assert.equal(formatDriveDate(DAY.date, null), "11.09.2026");
  });

  test("версия и статус", () => {
    assert.equal(
      callSheetDriveFileName(DAY, "Europe/Moscow", { status: "DRAFT", version: 2 }),
      "Вызывной · день 12 · 11.09.2026 · версия 2 (черновик)",
    );
    assert.equal(
      callSheetDriveFileName(DAY, "Europe/Moscow", { status: "IN_REVIEW", version: 3 }),
      "Вызывной · день 12 · 11.09.2026 · версия 3 (на согласовании)",
    );
    assert.equal(
      callSheetDriveFileName(DAY, "Europe/Moscow", { status: "APPROVED", version: 2 }),
      "Вызывной · день 12 · 11.09.2026 · версия 2 (утверждён)",
    );
  });

  test("вызывной ещё не создан — без версии", () => {
    assert.equal(
      callSheetDriveFileName(DAY, "Europe/Moscow", { status: "DRAFT", version: null }),
      "Вызывной · день 12 · 11.09.2026 (черновик)",
    );
  });

  test("папка проекта на Google", () => {
    assert.equal(googleProjectFolderName("  Фильм "), "PELENA · Фильм");
    assert.equal(googleProjectFolderName(""), "PELENA · Проект");
  });
});

describe("папка проекта на Яндексе", () => {
  test("название и 6 последних символов id: одноимённые проекты — разные папки", () => {
    assert.equal(yandexProjectFolderName("Фильм", "cmvy9kist0004dwjc5opl96tl"), "Фильм · pl96tl");
    assert.notEqual(
      yandexProjectFolderName("Фильм", "cmvy9kist0004dwjc5opl96tl"),
      yandexProjectFolderName("Фильм", "cmvy9kist0004dwjc5aaaaaa"),
    );
    assert.equal(yandexProjectFolderName("  ", "abcdef123456"), "Проект · 123456");
  });
});

describe("версия по умолчанию", () => {
  test("утверждён — его версия; черновик и на согласовании — текущая", () => {
    assert.equal(defaultDriveExportVersion({ status: "APPROVED", version: 3 }), 3);
    assert.equal(defaultDriveExportVersion({ status: "DRAFT", version: 3 }), null);
    assert.equal(defaultDriveExportVersion({ status: "IN_REVIEW", version: 1 }), null);
    assert.equal(defaultDriveExportVersion(null), null);
  });
});

describe("что пришло из браузера", () => {
  test("провайдер и версия", () => {
    assert.deepEqual(parseDriveExportInput({ provider: "GOOGLE_DRIVE", version: null }), {
      provider: "GOOGLE_DRIVE",
      version: undefined,
    });
    assert.deepEqual(parseDriveExportInput({ provider: "YANDEX_DISK", version: 2 }), {
      provider: "YANDEX_DISK",
      version: 2,
    });
    assert.deepEqual(parseDriveExportInput({ provider: "YANDEX_DISK" }), {
      provider: "YANDEX_DISK",
      version: undefined,
    });
  });

  test("всё остальное — отказ", () => {
    const bad = { error: DRIVE_EXPORT_BAD_INPUT };
    for (const raw of [
      null,
      "GOOGLE_DRIVE",
      [],
      {},
      { provider: "DROPBOX" },
      { provider: "GOOGLE_DRIVE", version: 0 },
      { provider: "GOOGLE_DRIVE", version: -1 },
      { provider: "GOOGLE_DRIVE", version: 1.5 },
      { provider: "GOOGLE_DRIVE", version: "2" },
      { provider: "GOOGLE_DRIVE", version: 10_000_000 },
    ]) {
      assert.deepEqual(parseDriveExportInput(raw), bad, JSON.stringify(raw));
    }
  });

  test("лишние поля (почты, id папок) не попадают в результат", () => {
    assert.deepEqual(
      parseDriveExportInput({ provider: "GOOGLE_DRIVE", folderId: "x", email: "a@b.c" }),
      { provider: "GOOGLE_DRIVE", version: undefined },
    );
  });
});

describe("сообщение после выгрузки", () => {
  test("замена — ссылка прежняя, пересоздание — сообщить", () => {
    assert.match(driveExportDoneText("GOOGLE_DRIVE", "replaced"), /ссылка прежняя/);
    assert.match(driveExportDoneText("GOOGLE_DRIVE", "recreated"), /удалили.*ссылка новая/);
    assert.match(driveExportDoneText("YANDEX_DISK", "recreated"), /создан заново/);
    assert.equal(driveExportDoneText("YANDEX_DISK", "created"), "Вызывной выгружен на Яндекс Диск");
  });
});
