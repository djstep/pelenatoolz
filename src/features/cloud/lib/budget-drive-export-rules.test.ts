import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BUDGET_DRIVE_APPROVAL_NOTE,
  budgetDriveKeeperHint,
  BUDGET_SUMMARY_DOC_ID,
  budgetDriveAccess,
  budgetDriveAudienceText,
  budgetDriveDocId,
  budgetDriveExportDoneText,
  budgetDriveFileName,
  budgetDriveFolderKey,
  budgetDriveOutdatedText,
  budgetDrivePlaceLabel,
  budgetDriveStatusLabel,
  canExportBudgetToDrive,
  defaultBudgetDriveVersion,
  parseBudgetDriveRequest,
  resolveBudgetDriveSource,
  summaryDriveFileName,
  summaryDriveSnapshotText,
  type BudgetDriveActor,
  type BudgetDriveTarget,
} from "@/features/cloud/lib/budget-drive-export-rules";
import {
  assertShareableFolderKey,
  BUDGET_FOLDER_KEYS,
  budgetDepartmentFolderKey,
  desiredFolderGrants,
  isBudgetFileFolderKey,
  type AccessMember,
} from "@/features/cloud/lib/drive-access-rules";
import { DRIVE_EXPORT_BAD_INPUT } from "@/features/cloud/lib/drive-export-rules";

const ART = "dep-art";
const SOUND = "dep-sound";

const actor = (over: Partial<BudgetDriveActor> = {}): BudgetDriveActor => ({
  isProducer: false,
  headDepartmentIds: [],
  ...over,
});

const producer = actor({ isProducer: true });
/** Глава «Звука» — без «Финансы: просмотр» (финансовых признаков в правилах нет вовсе). */
const soundHead = actor({ headDepartmentIds: [SOUND] });
/** «Сметы — просмотр всех» без продюсера и без главенства. */
const readAll = actor();

const dept = (departmentId: string): BudgetDriveTarget => ({ kind: "department", departmentId });
const summary: BudgetDriveTarget = { kind: "summary" };

describe("кто выгружает (решение 8)", () => {
  test("продюсер — смету любого цеха и сводную", () => {
    assert.deepEqual(budgetDriveAccess(producer), { summary: true, departments: "all" });
    assert.equal(canExportBudgetToDrive(producer, dept(ART)), true);
    assert.equal(canExportBudgetToDrive(producer, summary), true);
  });

  test("глава без «Финансы: просмотр» — смету своего цеха; чужого и сводную — нет", () => {
    assert.equal(canExportBudgetToDrive(soundHead, dept(SOUND)), true);
    assert.equal(canExportBudgetToDrive(soundHead, dept(ART)), false);
    assert.equal(canExportBudgetToDrive(soundHead, summary), false);
  });

  test("«Сметы — просмотр всех» (не глава, не продюсер) — ничего", () => {
    assert.deepEqual(budgetDriveAccess(readAll), { summary: false, departments: [] });
    assert.equal(canExportBudgetToDrive(readAll, dept(ART)), false);
    assert.equal(canExportBudgetToDrive(readAll, summary), false);
  });

  test("главы нескольких цехов — без повторов", () => {
    assert.deepEqual(budgetDriveAccess(actor({ headDepartmentIds: [ART, SOUND, ART] })).departments, [ART, SOUND]);
  });

  test("выгружает только тот, кто сам получает доступ к папке", () => {
    const folders = [
      { id: "f-sum", key: budgetDriveFolderKey(summary), departmentId: null },
      { id: "f-art", key: budgetDriveFolderKey(dept(ART)), departmentId: ART },
      { id: "f-sound", key: budgetDriveFolderKey(dept(SOUND)), departmentId: SOUND },
    ];
    const cases: [string, BudgetDriveActor, Partial<AccessMember>][] = [
      ["producer", producer, { isProducer: true }],
      ["sound-head", soundHead, {}],
      ["read-all", readAll, {}],
    ];
    const members: AccessMember[] = cases.map(([id, , over]) => ({
      userId: `u-${id}`,
      membershipId: `m-${id}`,
      status: "ACTIVE",
      isProducer: false,
      canReadCallSheets: true,
      email: `${id}@x.test`,
      googleEmail: null,
      ...over,
    }));
    const granted = desiredFolderGrants({
      folders,
      members,
      departmentHeads: [{ departmentId: SOUND, membershipId: "m-sound-head" }],
      driveAccountEmail: "drive@x.test",
    });
    const targets: [string, BudgetDriveTarget][] = [
      ["f-sum", summary],
      ["f-art", dept(ART)],
      ["f-sound", dept(SOUND)],
    ];
    for (const [id, a] of cases) {
      for (const [folderId, target] of targets) {
        const sees = granted.some((g) => g.folderId === folderId && g.userId === `u-${id}`);
        assert.equal(canExportBudgetToDrive(a, target), sees, `${id} → ${folderId}`);
      }
    }
  });
});

describe("папка и документ", () => {
  test("смета цеха — папка цеха смет, сводная — «Сводная»; обе конечные папки смет", () => {
    assert.equal(budgetDriveFolderKey(dept(ART)), budgetDepartmentFolderKey(ART));
    assert.equal(budgetDriveFolderKey(summary), BUDGET_FOLDER_KEYS.summary);
    for (const t of [dept(ART), summary]) {
      assert.equal(isBudgetFileFolderKey(budgetDriveFolderKey(t)), true);
      assert.doesNotThrow(() => assertShareableFolderKey(budgetDriveFolderKey(t)));
    }
  });

  test("docId: смета цеха — id цеха, сводная — summary", () => {
    assert.equal(budgetDriveDocId(dept(ART)), ART);
    assert.equal(budgetDriveDocId(summary), BUDGET_SUMMARY_DOC_ID);
  });
});

describe("версия (решения 3, 12)", () => {
  test("по умолчанию: утверждена — последняя утверждённая, иначе текущая", () => {
    assert.equal(defaultBudgetDriveVersion({ status: "APPROVED", latestVersion: 3 }), 3);
    for (const status of ["DRAFT", "SUBMITTED", "RETURNED"] as const) {
      assert.equal(defaultBudgetDriveVersion({ status, latestVersion: 3 }), null, status);
    }
    assert.equal(defaultBudgetDriveVersion({ status: "DRAFT", latestVersion: null }), null);
  });

  test("на сервере: выбрана версия — она; нет — как по умолчанию", () => {
    assert.deepEqual(resolveBudgetDriveSource({ status: "SUBMITTED", latestVersion: 3 }, 2), {
      kind: "version",
      number: 2,
    });
    assert.deepEqual(resolveBudgetDriveSource({ status: "APPROVED", latestVersion: 3 }, undefined), {
      kind: "version",
      number: 3,
    });
    assert.deepEqual(resolveBudgetDriveSource({ status: "SUBMITTED", latestVersion: 3 }, undefined), {
      kind: "current",
      status: "SUBMITTED",
    });
  });

  test("метка статуса", () => {
    assert.equal(budgetDriveStatusLabel({ kind: "version", number: 2 }), "утверждена");
    assert.equal(budgetDriveStatusLabel({ kind: "current", status: "DRAFT" }), "черновик");
    assert.equal(budgetDriveStatusLabel({ kind: "current", status: "SUBMITTED" }), "на утверждении");
    assert.equal(budgetDriveStatusLabel({ kind: "current", status: "RETURNED" }), "возвращена");
  });

  test("на диске версия старше утверждённой — подсказка; иначе ничего", () => {
    assert.equal(budgetDriveOutdatedText({ version: 2 }, 3), "На диске — версия 2, утверждена версия 3");
    assert.equal(budgetDriveOutdatedText({ version: 3 }, 3), null);
    assert.equal(budgetDriveOutdatedText({ version: null }, 3), null, "на диске черновик");
    assert.equal(budgetDriveOutdatedText(null, 3), null);
    assert.equal(budgetDriveOutdatedText({ version: 2 }, null), null);
  });
});

describe("имя файла", () => {
  // 21:30 UTC 2 ноября — в Москве уже 3 ноября.
  const at = new Date("2026-11-02T21:30:00.000Z");

  test("утверждённая версия — без даты", () => {
    assert.equal(
      budgetDriveFileName("Звук", { kind: "version", number: 3 }, at, "Europe/Moscow"),
      "Смета · Звук · версия 3 (утверждена)",
    );
  });

  test("текущий лист — статус и дата выгрузки по поясу проекта", () => {
    const name = (status: "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED") =>
      budgetDriveFileName(" Звук ", { kind: "current", status }, at, "Europe/Moscow");
    assert.equal(name("DRAFT"), "Смета · Звук · черновик · 03.11.2026");
    assert.equal(name("SUBMITTED"), "Смета · Звук · черновик (на утверждении) · 03.11.2026");
    assert.equal(name("RETURNED"), "Смета · Звук · черновик (возвращена) · 03.11.2026");
    assert.equal(name("APPROVED"), "Смета · Звук · текущая (утверждена) · 03.11.2026");
    assert.equal(
      budgetDriveFileName("Звук", { kind: "current", status: "DRAFT" }, at, "UTC"),
      "Смета · Звук · черновик · 02.11.2026",
    );
  });

  test("сводная — режим и дата", () => {
    assert.equal(summaryDriveFileName(false, at, "Europe/Moscow"), "Сводная смета · утверждённые версии · 03.11.2026");
    assert.equal(summaryDriveFileName(true, at, "Europe/Moscow"), "Сводная смета · с черновиками · 03.11.2026");
  });
});

describe("что пришло из браузера", () => {
  test("смета цеха: цех и номер версии (пусто — по умолчанию)", () => {
    assert.deepEqual(parseBudgetDriveRequest({ target: "department", departmentId: ART }), {
      target: { kind: "department", departmentId: ART },
      version: undefined,
    });
    assert.deepEqual(parseBudgetDriveRequest({ target: "department", departmentId: ART, version: 2 }), {
      target: { kind: "department", departmentId: ART },
      version: 2,
    });
  });

  test("сводная: только «с черновиками»", () => {
    assert.deepEqual(parseBudgetDriveRequest({ target: "summary" }), { target: { kind: "summary" }, drafts: false });
    assert.deepEqual(parseBudgetDriveRequest({ target: "summary", drafts: true }), {
      target: { kind: "summary" },
      drafts: true,
    });
  });

  test("лишнее игнорируется: почты, папки, проект, суммы", () => {
    const parsed = parseBudgetDriveRequest({
      target: "department",
      departmentId: ART,
      projectId: "other-project",
      folderId: "google-folder",
      email: "x@gmail.com",
      total: 1_000_000,
    });
    assert.deepEqual(parsed, { target: { kind: "department", departmentId: ART }, version: undefined });
  });

  test("мусор — отказ", () => {
    const bad: unknown[] = [
      null,
      "summary",
      [],
      {},
      { target: "personal" },
      { target: "common" },
      { target: "department" },
      { target: "department", departmentId: "" },
      { target: "department", departmentId: "x".repeat(101) },
      { target: "department", departmentId: 5 },
      { target: "department", departmentId: ART, version: 0 },
      { target: "department", departmentId: ART, version: 1.5 },
      { target: "department", departmentId: ART, version: "2" },
      { target: "summary", drafts: "yes" },
    ];
    for (const raw of bad) {
      assert.deepEqual(parseBudgetDriveRequest(raw), { error: DRIVE_EXPORT_BAD_INPUT }, JSON.stringify(raw));
    }
  });
});

describe("окно сводной (шаг 5)", () => {
  test("снимок — дата по поясу проекта, факт на дату выгрузки", () => {
    // 23:30 UTC 2 ноября — в Москве уже 3 ноября.
    const text = summaryDriveSnapshotText(new Date("2026-11-02T23:30:00.000Z"), "Europe/Moscow");
    assert.match(text, /^Снимок на 03\.11\.2026: /);
    assert.match(text, /факт \(начислено \/ оплачено\) на дату выгрузки/);
  });

  test("кто увидит — только продюсеры; глава и «просмотр всех» сводную не выгружают", () => {
    assert.equal(budgetDriveAudienceText({ kind: "summary" }, null), "Только продюсеры");
    assert.equal(canExportBudgetToDrive({ isProducer: false, headDepartmentIds: ["d1"] }, { kind: "summary" }), false);
    assert.equal(canExportBudgetToDrive({ isProducer: true, headDepartmentIds: [] }, { kind: "summary" }), true);
  });
});

describe("тексты окна (шаг 4)", () => {
  test("утверждение — только в системе; подсказка хранителю — со служебным аккаунтом", () => {
    assert.match(BUDGET_DRIVE_APPROVAL_NOTE, /^Утверждение — только в системе/);
    assert.match(budgetDriveKeeperHint("keeper@company.test"), /аккаунте «keeper@company.test»/);
    assert.match(budgetDriveKeeperHint(null), /аккаунте хранителя диска проекта/);
    assert.match(budgetDriveKeeperHint(null), /служебный аккаунт компании/);
  });
});

describe("тексты", () => {
  test("кто увидит", () => {
    assert.equal(budgetDriveAudienceText(dept(SOUND), "Звук"), "Главы цеха «Звук» и продюсеры");
    assert.equal(budgetDriveAudienceText(summary, null), "Только продюсеры");
  });

  test("место и итог выгрузки", () => {
    const place = budgetDrivePlaceLabel(dept(SOUND), "Звук");
    assert.equal(place, "папка цеха «Звук» в «Сметах»");
    assert.equal(budgetDrivePlaceLabel(summary, null), "«Сметы / Сводная»");
    assert.equal(budgetDriveExportDoneText(dept(SOUND), "created", place), `Смета выгружена на диск проекта — ${place}`);
    assert.equal(
      budgetDriveExportDoneText(summary, "created", "«Сметы / Сводная»"),
      "Сводная смета выгружена на диск проекта — «Сметы / Сводная»",
    );
    assert.match(budgetDriveExportDoneText(summary, "replaced", "x"), /ссылка прежняя/);
    assert.match(budgetDriveExportDoneText(summary, "recreated", "x"), /ссылка новая/);
  });
});
