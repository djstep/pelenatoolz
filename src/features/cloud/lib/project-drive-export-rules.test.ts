import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  DRIVE_EXPORT_BAD_INPUT,
  parseDriveExportRequest,
  type DriveExportDestination,
} from "@/features/cloud/lib/drive-export-rules";
import {
  canExportToDestination,
  departmentsForExport,
  driveDestinationAccess,
  hasProjectDriveDestinations,
  projectDriveAudienceText,
  projectDriveExportDoneText,
  projectDrivePlaceLabel,
  projectDriveUnavailable,
  projectDriveUnavailableText,
  type DriveExportActor,
} from "@/features/cloud/lib/project-drive-export-rules";

const SOUND = "dep-sound";
const ART = "dep-art";
const DEPARTMENTS = [
  { id: ART, name: "Художественный" },
  { id: SOUND, name: "Звук" },
];

const actor = (over: Partial<DriveExportActor> = {}): DriveExportActor => ({
  canReadCallSheets: true,
  canEditCallSheets: true,
  isProducer: false,
  headDepartmentIds: [],
  ...over,
});

const producer = actor({ isProducer: true });
/** Глава «Звука» с просмотром вызывных, без правки (как обычный глава цеха). */
const soundHead = actor({ canEditCallSheets: false, headDepartmentIds: [SOUND] });
/** Глава «Звука», у роли которого вызывные не видны вовсе. */
const soundHeadNoCallSheets = actor({
  canReadCallSheets: false,
  canEditCallSheets: false,
  headDepartmentIds: [SOUND],
});
/** Роль с просмотром вызывных без правки, не глава. */
const viewer = actor({ canEditCallSheets: false });
/** Роль с правкой вызывных (ассистент режиссёра), не глава. */
const editor = actor();
const noCallSheets = actor({ canReadCallSheets: false, canEditCallSheets: false });

const PERSONAL: DriveExportDestination = { kind: "personal", provider: "GOOGLE_DRIVE" };
const COMMON: DriveExportDestination = { kind: "common" };
const dept = (departmentId: string): DriveExportDestination => ({ kind: "department", departmentId });

/** Что человек видит в окне и куда может выгрузить: личный, «Общая», цеха. */
function summary(a: DriveExportActor) {
  const access = driveDestinationAccess(a);
  const departments = departmentsForExport(access, DEPARTMENTS).map((d) => d.name);
  return {
    personal: access.personal,
    common: access.common,
    departments,
    projectSection: hasProjectDriveDestinations(access, departments.length),
    can: {
      personal: canExportToDestination(a, PERSONAL),
      common: canExportToDestination(a, COMMON),
      sound: canExportToDestination(a, dept(SOUND)),
      art: canExportToDestination(a, dept(ART)),
    },
  };
}

describe("назначения выгрузки — кто что видит и может (решение 11, п. 5)", () => {
  test("продюсер: личный, «Общая», все цеха", () => {
    assert.deepEqual(summary(producer), {
      personal: true,
      common: true,
      departments: ["Художественный", "Звук"],
      projectSection: true,
      can: { personal: true, common: true, sound: true, art: true },
    });
  });

  test("продюсер без права правки вызывных — цеха да, «Общая» нет", () => {
    const s = summary(actor({ isProducer: true, canEditCallSheets: false }));
    assert.equal(s.common, false);
    assert.deepEqual(s.can, { personal: true, common: false, sound: true, art: true });
  });

  test("глава «Звука» с просмотром вызывных: личный и только свой цех; «Общая» — нет (нет правки)", () => {
    assert.deepEqual(summary(soundHead), {
      personal: true,
      common: false,
      departments: ["Звук"],
      projectSection: true,
      can: { personal: true, common: false, sound: true, art: false },
    });
  });

  test("глава цеха с правкой вызывных: «Общая» и свой цех, чужой — нет", () => {
    const s = summary(actor({ headDepartmentIds: [SOUND] }));
    assert.deepEqual(s.can, { personal: true, common: true, sound: true, art: false });
    assert.deepEqual(s.departments, ["Звук"]);
  });

  test("глава цеха без просмотра вызывных: ничего, даже свой цех", () => {
    assert.deepEqual(summary(soundHeadNoCallSheets), {
      personal: false,
      common: false,
      departments: [],
      projectSection: false,
      can: { personal: false, common: false, sound: false, art: false },
    });
  });

  test("роль с просмотром без правки, не глава: только личный диск, раздела диска проекта нет", () => {
    assert.deepEqual(summary(viewer), {
      personal: true,
      common: false,
      departments: [],
      projectSection: false,
      can: { personal: true, common: false, sound: false, art: false },
    });
  });

  test("роль с правкой вызывных, не глава: личный и «Общая», цеха — нет", () => {
    assert.deepEqual(summary(editor).can, { personal: true, common: true, sound: false, art: false });
  });

  test("роль без вызывных: ничего (правка без просмотра тоже не даёт «Общую»)", () => {
    assert.deepEqual(summary(noCallSheets).can, { personal: false, common: false, sound: false, art: false });
    assert.equal(summary(actor({ canReadCallSheets: false, isProducer: true })).can.sound, false);
  });

  test("цех, которого нет в проекте, главе не показывается; повтор id — один цех", () => {
    const access = driveDestinationAccess(actor({ headDepartmentIds: [SOUND, SOUND, "dep-other-project"] }));
    assert.deepEqual(departmentsForExport(access, DEPARTMENTS), [{ id: SOUND, name: "Звук" }]);
  });
});

describe("диск проекта недоступен", () => {
  const ok = { status: "ACTIVE" as const, hasToken: true, needsReconnect: false, keeperActiveProducer: true };

  test("подключён, токен есть, хранитель — активный продюсер → можно", () => {
    assert.equal(projectDriveUnavailable(ok), null);
  });

  test("нет диска / отключён / без токена / хранитель не продюсер → «не подключён»", () => {
    assert.equal(projectDriveUnavailable(null), "not_connected");
    assert.equal(projectDriveUnavailable({ ...ok, status: "DETACHED" }), "not_connected");
    assert.equal(projectDriveUnavailable({ ...ok, hasToken: false }), "not_connected");
    assert.equal(projectDriveUnavailable({ ...ok, keeperActiveProducer: false }), "not_connected");
  });

  test("пометка «нужно переподключить» → reconnect", () => {
    assert.equal(projectDriveUnavailable({ ...ok, needsReconnect: true }), "reconnect");
  });

  test("тексты: продюсерам — в настройки, остальным — к продюсеру", () => {
    assert.equal(
      projectDriveUnavailableText("not_connected", false),
      "Диск проекта не подключён — обратитесь к продюсеру",
    );
    assert.match(projectDriveUnavailableText("not_connected", true), /в настройках проекта/);
    assert.match(projectDriveUnavailableText("reconnect", false), /отозван — обратитесь к продюсеру/);
    assert.match(projectDriveUnavailableText("reconnect", true), /переподключите его в настройках проекта/);
  });
});

describe("тексты окна и журнала", () => {
  test("кто увидит файл", () => {
    assert.equal(projectDriveAudienceText("common", null), "Все участники с доступом к вызывным");
    assert.equal(projectDriveAudienceText("department", "Звук"), "Главы цеха «Звук» и продюсеры");
  });

  test("куда легло и итог", () => {
    assert.equal(projectDrivePlaceLabel("common", null), "«Общая»");
    assert.equal(projectDrivePlaceLabel("department", "Звук"), "папка цеха «Звук»");
    assert.equal(projectDriveExportDoneText("created", "«Общая»"), "Вызывной выгружен на диск проекта — «Общая»");
    assert.match(projectDriveExportDoneText("replaced", "«Общая»"), /ссылка прежняя/);
    assert.match(projectDriveExportDoneText("recreated", "папка цеха «Звук»"), /создан новый файл .*ссылка новая/);
  });
});

describe("что пришло из браузера (назначение)", () => {
  test("без назначения — личный диск, как в шаге 3", () => {
    assert.deepEqual(parseDriveExportRequest({ provider: "GOOGLE_DRIVE", version: null }), {
      destination: { kind: "personal", provider: "GOOGLE_DRIVE" },
      version: undefined,
    });
    assert.deepEqual(parseDriveExportRequest({ destination: "personal", provider: "YANDEX_DISK", version: 3 }), {
      destination: { kind: "personal", provider: "YANDEX_DISK" },
      version: 3,
    });
  });

  test("«Общая» и цех: провайдер не нужен, лишние поля (почты, id папок) не берутся", () => {
    assert.deepEqual(
      parseDriveExportRequest({ destination: "common", version: 2, folderId: "x", email: "a@b.c" }),
      { destination: { kind: "common" }, version: 2 },
    );
    assert.deepEqual(parseDriveExportRequest({ destination: "department", departmentId: SOUND }), {
      destination: { kind: "department", departmentId: SOUND },
      version: undefined,
    });
  });

  test("мусор — отказ", () => {
    const bad = { error: DRIVE_EXPORT_BAD_INPUT };
    for (const raw of [
      null,
      [],
      { destination: "personal" },
      { destination: "shared" },
      { destination: "department" },
      { destination: "department", departmentId: "" },
      { destination: "department", departmentId: 5 },
      { destination: "department", departmentId: "x".repeat(101) },
      { destination: "common", version: 0 },
      { destination: "common", version: "2" },
    ]) {
      assert.deepEqual(parseDriveExportRequest(raw), bad, JSON.stringify(raw));
    }
  });
});

/**
 * Порядок проверок и блокировка — по коду (как `drive-export-service.test.ts`): база здесь не поднимается.
 */
const actions = readFileSync(new URL("../../call-sheets/drive-actions.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("./drive-export-service.ts", import.meta.url), "utf8");
const projectPart = service.slice(service.indexOf("export async function putCallSheetOnProjectDrive("));

describe("сервер: проверки до выгрузки на диск проекта", () => {
  test("вход и проект → право просмотра → день и цех этого проекта → право по назначению → выгрузка", () => {
    const body = actions.slice(actions.indexOf("export async function exportCallSheetToDriveAction("));
    const order = [
      "requireProjectContext(projectId)",
      "canReadCallSheet(ctx)",
      "parseDriveExportRequest(input)",
      "dayOfProject(projectId, dayId)",
      "departmentOfProject(projectId, destination.departmentId)",
      "canExportToDestination(exportActor(ctx), destination)",
      "loadCallSheetPrintModel(",
      "putCallSheetOnProjectDrive(",
    ].map((s) => body.indexOf(s));
    for (const [i, at] of order.entries()) assert.ok(at > 0, `нет шага ${i}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(actions, /assertInProject\("Department", departmentId, projectId\)/);
  });

  test("права — из проверенного контекста, не из браузера", () => {
    assert.match(actions, /headDepartmentIds: ctx\.headDepartmentIds/);
    assert.match(actions, /isProducer: isProducerRole\(ctx\.role\)/);
  });

  test("строка ProjectDrive под FOR UPDATE до папок, поиска прежней выгрузки и записи", () => {
    const lock = projectPart.search(/FROM "ProjectDrive" WHERE "projectId" = \$\{projectId\} FOR UPDATE/);
    const folders = projectPart.indexOf("ensureProjectFolderChain(tx,");
    const findExisting = projectPart.indexOf("tx.driveExport.findUnique(");
    const write = projectPart.indexOf("tx.driveExport.upsert(");
    assert.ok(lock > 0, "нет SELECT … FOR UPDATE по диску проекта");
    assert.ok(lock < folders && folders < findExisting && findExisting < write);
    assert.ok(projectPart.indexOf("SET LOCAL lock_timeout") < lock);
  });

  test("под блокировкой — повторная проверка: тот же диск, активен, без «переподключить», хранитель продюсер", () => {
    const lock = projectPart.indexOf("FOR UPDATE");
    const folders = projectPart.indexOf("ensureProjectFolderChain(tx,");
    const checks = projectPart.slice(lock, folders);
    assert.match(checks, /row\.connectedAt\.getTime\(\) !== drive\.connectedAt\.getTime\(\)/);
    assert.match(checks, /row\.status !== ProjectDriveStatus\.ACTIVE/);
    assert.match(checks, /row\.needsReconnectAt/);
    assert.match(checks, /keeperStillValid\(/);
  });

  test("токен — до транзакции; пометка «переподключить» и выдача доступов — после", () => {
    const tx = projectPart.indexOf("prisma.$transaction(");
    assert.ok(projectPart.indexOf("getProjectDriveAccessToken(projectId, userId)") < tx);
    const txEnd = projectPart.indexOf("{ maxWait: 10_000, timeout: TX_TIMEOUT_MS }");
    assert.ok(projectPart.indexOf("markProjectDriveNeedsReconnect(") > txEnd);
    assert.ok(projectPart.indexOf("scheduleNewProjectFolderAccess(") > txEnd);
  });

  test("запросы к Google — через предел; после предела папки не пишутся", () => {
    assert.match(projectPart, /folder = await beforeDeadline\(\s*ensureProjectFolderChain/);
    assert.match(projectPart, /put = await beforeDeadline\(\s*putCallSheetInGoogleFolder/);
    assert.match(projectPart, /canWrite: \(\) => !closed/);
    assert.match(projectPart, /closed = true;\s*return \{ failure: e \};/);
  });

  test("журнал — без ссылок и почт", () => {
    const changes = projectPart.slice(projectPart.indexOf("changes: {"), projectPart.indexOf("{ db: tx }"));
    assert.doesNotMatch(changes, /webUrl|externalId|email/i);
  });
});
