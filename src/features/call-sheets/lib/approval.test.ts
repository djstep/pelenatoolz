import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  bumpCallSheetRevision,
  CALL_SHEET_APPROVED,
  CallSheetEditRefused,
  parseExpectedRevision,
  REVISION_CONFLICT,
  revisionError,
  runWithRevision,
  type LockedCallSheet,
  type RevisionDb,
} from "@/features/call-sheets/lib/revision";
import {
  applyStatusCommand,
  canRunStatusCommand,
  planStatusTransition,
  SHEET_NOT_CREATED,
  type StatusCommand,
  type StatusDb,
} from "@/features/call-sheets/lib/status-rules";
import { NO_RIGHTS } from "@/features/call-sheets/lib/template-rules";
import { buildCallSheetHtml } from "@/features/call-sheets/print/print-html";
import { buildCallSheetPrintModel } from "@/features/call-sheets/print/print-model";
import {
  callSheetDataHash,
  callSheetPreviewSrc,
  choosePrintSource,
  parseSnapshotModel,
  parseVersionParam,
} from "@/features/call-sheets/print/print-source";
import { buildCallSheetWorkbook } from "@/features/call-sheets/print/print-xlsx";
import { IRP_DAY_SOURCE } from "@/features/call-sheets/print/preview-fixtures";
import { formatApprovedAt, stampVersion } from "@/features/call-sheets/print/stamp";
import { hasPermission } from "@/features/memberships/permissions";
import {
  buildFullMatrix,
  buildViewerMatrix,
  fullSectionPermissions,
  isSectionFlagAllowed,
  normalizePermissionMatrix,
  parsePermissionMatrix,
} from "@/features/roles/permissions-matrix";

/** Шаг 4: номер правки, статусы, утверждение, снимки, права. */

function source(relative: string) {
  return readFileSync(path.join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");
}

/** Тело экспортированной функции — до следующего `export` верхнего уровня. */
function functionBody(file: string, name: string) {
  const text = source(file);
  const start = text.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} в ${file}`);
  const next = text.indexOf("\nexport ", start + 10);
  return text.slice(start, next < 0 ? undefined : next);
}

function exportedFunctions(file: string) {
  return [...source(file).matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]!);
}

// ---- Подставная база: строка вызывного и блокировка «по очереди», как FOR UPDATE ----

function fakeSheet(overrides: Partial<LockedCallSheet> = {}): LockedCallSheet {
  return { id: "cs1", status: "DRAFT", version: 1, revision: 5, ...overrides };
}

/** Транзакции идут строго по очереди (как ожидание блокировки строки); откат — копией. */
function fakeStore(sheet: LockedCallSheet | null) {
  const state = { sheet, versions: [] as { version: number }[], writes: [] as string[] };
  let queue: Promise<unknown> = Promise.resolve();
  function transaction<R>(fn: (tx: typeof state) => Promise<R>): Promise<R> {
    const run = queue.then(async () => {
      const draft = structuredClone(state);
      const result = await fn(draft);
      Object.assign(state, draft); // успех — изменения видны; исключение — откат
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  }
  const revisionDb = (tx: typeof state): RevisionDb => ({
    lockCallSheet: async () => (tx.sheet ? { ...tx.sheet } : null),
    setRevision: async (_id, revision) => {
      tx.sheet!.revision = revision;
    },
  });
  const statusDb = (tx: typeof state): StatusDb => ({
    lockCallSheet: async () => (tx.sheet ? { ...tx.sheet } : null),
    createApprovedVersion: async (_id, version) => {
      if (tx.versions.some((v) => v.version === version)) throw new Error("P2002");
      tx.versions.push({ version });
    },
    updateCallSheet: async (_id, data) => {
      tx.sheet = { ...tx.sheet!, status: data.status, version: data.version, revision: data.revision };
    },
  });
  return { state, transaction, revisionDb, statusDb };
}

function save(store: ReturnType<typeof fakeStore>, expected: number | null | undefined) {
  return runWithRevision(store.transaction, store.revisionDb, "day1", expected, async (tx) => {
    tx.writes.push("запись");
    return "ok";
  });
}

const RIGHTS = { canEdit: true, canApprove: true };

// ---- Номер правки ----

describe("номер правки: сверка и +1 в транзакции записи", () => {
  test("номер из формы: число, пусто — вызывного не было, мусор — отказ", () => {
    assert.equal(parseExpectedRevision("7"), 7);
    assert.equal(parseExpectedRevision(0), 0);
    assert.equal(parseExpectedRevision(""), null);
    assert.equal(parseExpectedRevision(null), null);
    assert.equal(parseExpectedRevision(undefined), null);
    for (const bad of ["-1", "1.5", "abc", "7 ", -1, 1.5, {}, "9".repeat(12)]) {
      assert.equal(parseExpectedRevision(bad), undefined, String(bad));
    }
  });

  test("совпал — запись и номер +1", async () => {
    const store = fakeStore(fakeSheet());
    const done = await save(store, 5);
    assert.deepEqual(done, { result: "ok", revision: 6 });
    assert.equal(store.state.sheet!.revision, 6);
    assert.deepEqual(store.state.writes, ["запись"]);
  });

  test("устаревший номер — отказ «изменили в другом окне» до записи, номер не меняется", async () => {
    for (const stale of [4, 6, 0, undefined]) {
      const store = fakeStore(fakeSheet());
      await assert.rejects(save(store, stale), (error: unknown) => {
        assert.ok(error instanceof CallSheetEditRefused);
        assert.equal(error.message, REVISION_CONFLICT);
        return true;
      });
      assert.deepEqual(store.state.writes, [], `номер ${stale}: записи нет`);
      assert.equal(store.state.sheet!.revision, 5);
    }
  });

  test("вызывного нет: без номера — запись как раньше; с номером — отказ (вызывной удалён)", async () => {
    assert.deepEqual(await save(fakeStore(null), null), { result: "ok", revision: null });
    await assert.rejects(save(fakeStore(null), 3), /изменили в другом окне/);
  });

  test("окно не знало о созданном вызывном (номер пуст) — отказ", async () => {
    await assert.rejects(save(fakeStore(fakeSheet({ revision: 0 })), null), /изменили в другом окне/);
  });

  test("два окна с одним номером: одно сохраняет, второе — отказ", async () => {
    const store = fakeStore(fakeSheet());
    const [a, b] = await Promise.allSettled([save(store, 5), save(store, 5)]);
    assert.equal(a.status, "fulfilled");
    assert.equal(b.status, "rejected");
    assert.equal((b as PromiseRejectedResult).reason.message, REVISION_CONFLICT);
    assert.equal(store.state.sheet!.revision, 6);
    assert.deepEqual(store.state.writes, ["запись"]);
  });

  test("утверждённый — отказ «нажмите „Внести изменения“» даже с верным номером", async () => {
    const store = fakeStore(fakeSheet({ status: "APPROVED" }));
    await assert.rejects(save(store, 5), (error: unknown) => {
      assert.equal((error as Error).message, CALL_SHEET_APPROVED);
      return true;
    });
    assert.deepEqual(store.state.writes, []);
    assert.equal(revisionError({ status: "APPROVED", revision: 5 }, 4), CALL_SHEET_APPROVED);
  });

  test("на согласовании правка разрешена (номер сверяется)", async () => {
    assert.equal(revisionError({ status: "IN_REVIEW", revision: 5 }, 5), null);
    const store = fakeStore(fakeSheet({ status: "IN_REVIEW" }));
    assert.equal((await save(store, 5)).revision, 6);
  });

  test("bumpCallSheetRevision: блокировка — первым делом, номер пишется только после сверки", async () => {
    const calls: string[] = [];
    const db: RevisionDb = {
      lockCallSheet: async () => {
        calls.push("lock");
        return fakeSheet();
      },
      setRevision: async (_id, revision) => {
        calls.push(`set ${revision}`);
      },
    };
    assert.equal(await bumpCallSheetRevision(db, "day1", 5), 6);
    assert.deepEqual(calls, ["lock", "set 6"]);
    calls.length = 0;
    await assert.rejects(bumpCallSheetRevision(db, "day1", 1));
    assert.deepEqual(calls, ["lock"]);
  });
});

// ---- Все мутации вызывного идут через номер правки ----

/** Мутации вызывного и данных дня, попадающих в лист (список — в WAVE_3_NOTES, шаг 4). */
const MUTATIONS: [file: string, name: string][] = [
  ["src/features/call-sheets/actions.ts", "refreshCallSheetFromTemplateAction"],
  ["src/features/call-sheets/actions.ts", "saveCallSheetSheetAction"],
  ["src/features/call-sheets/actions.ts", "refreshCallSheetFromScheduleAction"],
  ["src/features/call-sheets/elements-actions.ts", "saveCallSheetElementsAction"],
  ["src/features/day-docs/transport-actions.ts", "saveCallSheetTransportsAction"],
  ["src/features/day-docs/actions.ts", "updateCallSheetHeaderAction"],
  ["src/features/day-docs/actions.ts", "saveTimeSlotsAction"],
  ["src/features/day-docs/actions.ts", "saveActorCallsAction"],
  ["src/features/day-docs/actions.ts", "saveResourceCallsAction"],
  ["src/features/day-docs/actions.ts", "saveResourceUsagesAction"],
  ["src/features/day-docs/actions.ts", "addPerShiftResourceAction"],
  ["src/features/day-docs/actions.ts", "removePerShiftResourceAction"],
  ["src/features/day-docs/actions.ts", "toggleCallSheetPlanLockAction"],
  ["src/features/day-docs/actions.ts", "applyRecalculateActorTimingsAction"],
  ["src/features/day-docs/actions.ts", "applyRecalculateResourceTimingsAction"],
];

/** Остальные экспортированные действия этих файлов — и почему без номера правки. */
const NOT_MUTATIONS: Record<string, string> = {
  saveCallSheetTemplateAction: "шаблон проекта, не вызывной дня",
  createCallSheetAction: "создаёт вызывной (номер 0); второе окно — уникальный ключ дня",
  saveCallSheetSectionsAction: "разделы элементов — настройка проекта",
  previewRecalculateActorTimingsAction: "только чтение",
  previewRecalculateResourceTimingsAction: "только чтение",
  exportAttendanceSheetXlsxAction: "только чтение",
};

const DIRECT_WRITE =
  /prisma\.(\$transaction|\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany))\(/;

describe("каждая мутация вызывного сверяет номер правки", () => {
  test("в файлах действий нет записей вызывного мимо списка", () => {
    const files = [...new Set(MUTATIONS.map(([file]) => file))];
    const listed = new Set(MUTATIONS.map(([, name]) => name));
    for (const file of files) {
      for (const name of exportedFunctions(file)) {
        assert.ok(listed.has(name) || name in NOT_MUTATIONS, `${file}: ${name} — нет в списке`);
      }
    }
  });

  for (const [file, name] of MUTATIONS) {
    test(`${name}: номер из браузера → withCallSheetRevision, мимо транзакции не пишет`, () => {
      const body = functionBody(file, name);
      assert.ok(body.includes("parseExpectedRevision("), "номер правки из браузера");
      assert.ok(body.includes("withCallSheetRevision("), "запись — в транзакции с номером");
      assert.doesNotMatch(body, DIRECT_WRITE, "прямой записи нет");
      assert.match(body, /isCallSheetEditRefused|refusedState\(/, "отказ — текстом");
      assert.match(body, /revision: saved\.revision|revision = saved\.revision/, "новый номер — браузеру");
    });
  }

  test("«Обновить из КПП» синхронизирует ресурсы в той же транзакции", () => {
    const body = functionBody("src/features/call-sheets/actions.ts", "refreshCallSheetFromScheduleAction");
    assert.ok(body.includes("syncShootDayResourceUsages(shootDayId, tx)"));
  });

  test("блокировка строки — SELECT … FOR UPDATE по дню и проекту", () => {
    const db = source("src/features/call-sheets/revision-db.ts");
    assert.match(db, /FROM "CallSheet"\s+WHERE "shootDayId" = \$\{shootDayId\} AND "projectId" = \$\{projectId\}\s+FOR UPDATE/);
  });

  test("планер: сначала план (с номером правки), порядок сцен в КПП — только после него", () => {
    const planner = source("src/features/day-docs/components/call-sheet-planner.tsx");
    const saveAt = planner.indexOf("await saveTimeSlotsAction(");
    const reorderAt = planner.indexOf("await reorderScenesAction(");
    assert.ok(saveAt > 0 && reorderAt > saveAt);
    assert.ok(planner.includes("fd.set(REVISION_FIELD"));
  });

  test("экраны вызывного шлют номер правки и берут новый из ответа", () => {
    for (const file of [
      "src/features/call-sheets/components/call-sheet-template-blocks.tsx",
      "src/features/call-sheets/components/call-sheet-sheet-editor.tsx",
      "src/features/call-sheets/components/call-sheet-elements-editor.tsx",
      "src/features/call-sheets/components/call-sheet-status-panel.tsx",
      "src/features/day-docs/components/call-sheet-transport-editor.tsx",
      "src/features/day-docs/components/call-sheet-edit.tsx",
      "src/features/day-docs/components/call-sheet-planner.tsx",
      "src/features/day-docs/components/call-sheet-toolbar.tsx",
      "src/features/day-docs/components/call-sheet-recalculate-modal.tsx",
    ]) {
      assert.match(source(file), /useCallSheetRevision\(\)|useRevisionAction\(/, file);
    }
  });
});

// ---- Статусы ----

describe("статусы вызывного", () => {
  test("переходы: черновик → на согласовании → утверждён; возврат; «Внести изменения» — версия +1", () => {
    const step = (command: StatusCommand, sheet: LockedCallSheet) =>
      planStatusTransition(command, RIGHTS, sheet, sheet.revision);
    assert.deepEqual(step("submit", fakeSheet()), {
      from: { status: "DRAFT", version: 1 },
      to: { status: "IN_REVIEW", version: 1 },
      revision: 6,
    });
    assert.deepEqual(step("return", fakeSheet({ status: "IN_REVIEW" })), {
      from: { status: "IN_REVIEW", version: 1 },
      to: { status: "DRAFT", version: 1 },
      revision: 6,
    });
    assert.deepEqual(step("approve", fakeSheet({ status: "IN_REVIEW" })), {
      from: { status: "IN_REVIEW", version: 1 },
      to: { status: "APPROVED", version: 1 },
      revision: 6,
    });
    assert.deepEqual(step("reopen", fakeSheet({ status: "APPROVED", version: 3 })), {
      from: { status: "APPROVED", version: 3 },
      to: { status: "DRAFT", version: 4 },
      revision: 6,
    });
  });

  test("из неподходящего статуса — отказ", () => {
    assert.match(
      (planStatusTransition("approve", RIGHTS, fakeSheet(), 5) as { error: string }).error,
      /Черновик/,
    );
    assert.ok("error" in planStatusTransition("reopen", RIGHTS, fakeSheet({ status: "IN_REVIEW" }), 5));
    assert.ok("error" in planStatusTransition("submit", RIGHTS, fakeSheet({ status: "APPROVED" }), 5));
    assert.deepEqual(planStatusTransition("submit", RIGHTS, null, 5), { error: SHEET_NOT_CREATED });
  });

  test("утверждение при чужом номере правки — отказ", () => {
    for (const stale of [4, 6, null, undefined]) {
      assert.deepEqual(
        planStatusTransition("approve", RIGHTS, fakeSheet({ status: "IN_REVIEW" }), stale),
        { error: REVISION_CONFLICT },
      );
    }
  });

  test("без права «Вызывные — утверждение» утвердить нельзя (и до базы)", () => {
    const editor = { canEdit: true, canApprove: false };
    assert.equal(canRunStatusCommand("approve", editor), false);
    assert.deepEqual(
      planStatusTransition("approve", editor, fakeSheet({ status: "IN_REVIEW" }), 5),
      { error: NO_RIGHTS },
    );
    // Утверждающий без права правки: утвердить и вернуть — да, отправить и «Внести изменения» — нет.
    const approver = { canEdit: false, canApprove: true };
    assert.equal(canRunStatusCommand("approve", approver), true);
    assert.equal(canRunStatusCommand("return", approver), true);
    assert.equal(canRunStatusCommand("submit", approver), false);
    assert.equal(canRunStatusCommand("reopen", approver), false);

    const actions = source("src/features/call-sheets/status-actions.ts");
    const rightsAt = actions.indexOf("if (!canRunStatusCommand(command, rights)) return { error: NO_RIGHTS };");
    assert.ok(rightsAt > 0);
    assert.ok(rightsAt < actions.indexOf("checkCallSheetCommand("), "право — до базы");
    assert.ok(rightsAt < actions.indexOf("prisma.callSheet"), "право — до базы");
    assert.ok(actions.includes(`canApprove: ctx.can("callsheet:approve")`));
  });

  test("одновременное утверждение из двух окон: проходит одно, снимок — один", async () => {
    const store = fakeStore(fakeSheet({ status: "IN_REVIEW" }));
    const approve = () =>
      store.transaction((tx) =>
        applyStatusCommand(store.statusDb(tx), "day1", "approve", RIGHTS, 5, new Date()),
      );
    const results = await Promise.allSettled([approve(), approve()]);
    assert.deepEqual(
      results.map((r) => r.status),
      ["fulfilled", "rejected"],
    );
    assert.equal((results[1] as PromiseRejectedResult).reason.message, REVISION_CONFLICT);
    assert.deepEqual(store.state.versions, [{ version: 1 }]);
    assert.equal(store.state.sheet!.status, "APPROVED");
    assert.equal(store.state.sheet!.revision, 6);
  });

  test("правка утверждённого — отказ до «Внести изменения», после — черновик версии +1", async () => {
    const store = fakeStore(fakeSheet({ status: "APPROVED", version: 1, revision: 8 }));
    await assert.rejects(save(store, 8), /Внести изменения/);
    await store.transaction((tx) =>
      applyStatusCommand(store.statusDb(tx), "day1", "reopen", RIGHTS, 8, new Date()),
    );
    assert.equal(store.state.sheet!.status, "DRAFT");
    assert.equal(store.state.sheet!.version, 2);
    assert.equal(store.state.sheet!.revision, 9);
    await assert.rejects(save(store, 8), /изменили в другом окне/, "старое окно — отказ");
    assert.equal((await save(store, 9)).revision, 10);
  });

  test("отказ перехода — без записи (снимка нет, статус прежний)", async () => {
    const store = fakeStore(fakeSheet({ status: "IN_REVIEW" }));
    await assert.rejects(
      store.transaction((tx) =>
        applyStatusCommand(store.statusDb(tx), "day1", "approve", RIGHTS, 4, new Date()),
      ),
    );
    assert.deepEqual(store.state.versions, []);
    assert.equal(store.state.sheet!.status, "IN_REVIEW");
  });

  test("журнал переходов — auditMutation, статус и версия, без снимка; тип виден как вызывные", () => {
    const actions = source("src/features/call-sheets/status-actions.ts");
    assert.ok(actions.includes("auditMutation("));
    assert.ok(actions.includes("entityType: AuditEntityType.callSheetStatus"));
    const changes = actions.slice(actions.indexOf("changes: (_cmd, result) => ({"));
    assert.match(changes, /status: \{ from: result\.from\.status, to: result\.to\.status \}/);
    assert.match(changes, /version: \{ from: result\.from\.version, to: result\.to\.version \}/);
    assert.doesNotMatch(changes.slice(0, changes.indexOf("}),")), /snapshot|model/);
    const access = source("src/features/audit/lib/entity-access.ts");
    assert.ok(
      access.includes(`[AuditEntityType.callSheetStatus]: anyOf("callsheet:read", "schedule:read"),`),
    );
  });

  test("в «use server» файле статусов публичны только четыре перехода", () => {
    const actions = source("src/features/call-sheets/status-actions.ts");
    assert.match(actions, /^"use server";/);
    assert.deepEqual(exportedFunctions("src/features/call-sheets/status-actions.ts"), [
      "submitCallSheetForReviewAction",
      "returnCallSheetToDraftAction",
      "approveCallSheetAction",
      "reopenCallSheetAction",
    ]);
  });
});

// ---- Снимки, печать версии, отпечаток данных дня ----

describe("снимок утверждения и печать", () => {
  test("утверждённый печатается из снимка, черновик — из живых данных, версия из адреса — её снимок", () => {
    assert.deepEqual(choosePrintSource({ status: "APPROVED", version: 2 }, undefined), {
      kind: "snapshot",
      version: 2,
    });
    assert.deepEqual(choosePrintSource({ status: "DRAFT", version: 3 }, undefined), { kind: "live" });
    assert.deepEqual(choosePrintSource({ status: "IN_REVIEW", version: 3 }, undefined), { kind: "live" });
    assert.deepEqual(choosePrintSource(null, undefined), { kind: "live" });
    assert.deepEqual(choosePrintSource({ status: "DRAFT", version: 3 }, 1), { kind: "snapshot", version: 1 });
    assert.equal(parseVersionParam(null), undefined);
    assert.equal(parseVersionParam("2"), 2);
    for (const bad of ["0", "-1", "x", "1.5"]) assert.equal(parseVersionParam(bad), null, bad);
  });

  test("лист утверждённого — из снимка, а не из изменившихся данных дня", () => {
    const snapshot = buildCallSheetPrintModel(IRP_DAY_SOURCE);
    // Снимок хранится JSON (jsonb) — порядок ключей может поменяться.
    const stored = parseSnapshotModel(JSON.parse(JSON.stringify(snapshot)));
    assert.ok(stored);
    const live = buildCallSheetPrintModel({
      ...IRP_DAY_SOURCE,
      sheet: { ...IRP_DAY_SOURCE.sheet!, importantNote: "Новое после утверждения" },
    });
    const stamp = { status: "APPROVED" as const, version: 2, approvedAtLabel: "10.09 17:46" };
    const html = buildCallSheetHtml(stored, { stamp });
    assert.ok(!html.includes("Новое после утверждения"));
    assert.ok(buildCallSheetHtml(live, { stamp }).includes("Новое после утверждения"));
    assert.equal(parseSnapshotModel({ modelVersion: 2 }), null);
    assert.equal(parseSnapshotModel("x"), null);

    const loader = source("src/features/call-sheets/print/load-print-model.ts");
    const chooseAt = loader.indexOf("choosePrintSource(sheet, requested)");
    const snapshotAt = loader.indexOf("callSheetApprovedVersion.findUnique(");
    const liveAt = loader.indexOf("buildLiveCallSheet(projectId, gate.dayId)");
    assert.ok(chooseAt > 0 && chooseAt < snapshotAt && snapshotAt < liveAt);
  });

  test("отпечаток данных дня меняется при изменении данных, а не от прогноза погоды", () => {
    const hash = callSheetDataHash(IRP_DAY_SOURCE);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(callSheetDataHash(structuredClone(IRP_DAY_SOURCE)), hash);
    assert.notEqual(
      callSheetDataHash({
        ...IRP_DAY_SOURCE,
        sheet: { ...IRP_DAY_SOURCE.sheet!, importantNote: "Другое" },
      }),
      hash,
    );
    assert.notEqual(
      callSheetDataHash({ ...IRP_DAY_SOURCE, day: { ...IRP_DAY_SOURCE.day, shiftNumber: 99 } }),
      hash,
    );
    assert.equal(
      callSheetDataHash({
        ...IRP_DAY_SOURCE,
        astro: {
          sunrise: "04:00",
          sunset: "23:00",
          weatherSummary: "гроза",
          precipProb: 90,
          tempMax: 31,
          tempMin: 12,
        },
      }),
      hash,
      "прогноз и солнце в отпечаток не входят",
    );
  });

  test("утверждение: снимок и отпечаток — из одной сборки листа, под блокировкой и с номером правки", () => {
    const actions = source("src/features/call-sheets/status-actions.ts");
    assert.ok(actions.includes("live = await buildLiveCallSheet(projectId, checked.dayId)"));
    assert.ok(actions.includes("snapshot: live!.model"));
    assert.ok(actions.includes("modelHash: live!.dataHash"));
    assert.ok(actions.includes("lockCallSheetRow(tx, projectId, shootDayId)"));
    const loader = source("src/features/call-sheets/print/load-print-model.ts");
    assert.ok(loader.includes("dataHash: callSheetDataHash(source)"));
    const page = source("src/app/[locale]/projects/[projectId]/call-sheets/[dayId]/page.tsx");
    assert.ok(page.includes("approvedSnapshot.modelHash !== callSheetDataHash(printSource)"));
  });

  test("адрес просмотра меняется при утверждении и «Внести изменения»", () => {
    const model = buildCallSheetPrintModel(IRP_DAY_SOURCE);
    const draft = callSheetPreviewSrc("p", "d", model, { status: "DRAFT", version: 1 });
    assert.notEqual(callSheetPreviewSrc("p", "d", model, { status: "APPROVED", version: 1 }), draft);
    assert.notEqual(callSheetPreviewSrc("p", "d", model, { status: "DRAFT", version: 2 }), draft);
  });
});

describe("статус и версия на листе", () => {
  const model = buildCallSheetPrintModel(IRP_DAY_SOURCE);

  test("утверждённый: в шапке «версия N · утверждён ДД.ММ ЧЧ:ММ», без метки", () => {
    const html = buildCallSheetHtml(model, {
      stamp: { status: "APPROVED", version: 2, approvedAtLabel: "10.09 17:46" },
    });
    assert.match(html, /<div class="meta">[^\n]*версия 2 · утверждён 10\.09 17:46<\/div>/);
    assert.ok(!html.includes('class="stamp"'));
  });

  test("подвала нет ни в одном режиме (просмотр, печать, версии); бегущая шапка листов 2+ — есть", () => {
    const stamps = [
      undefined,
      { status: "DRAFT", version: null },
      { status: "DRAFT", version: 1 },
      { status: "IN_REVIEW", version: 1 },
      { status: "APPROVED", version: 2, approvedAtLabel: "10.09 17:46" },
    ] as const;
    for (const stamp of stamps) {
      // embed — печать, url — просмотр на странице (маршрут листа).
      for (const font of ["embed", "url"] as const) {
        const html = buildCallSheetHtml(model, { stamp, font });
        const label = `${stamp?.status ?? "без статуса"} ${font}`;
        assert.ok(!html.includes("@bottom-left"), label);
        assert.ok(!html.includes("@bottom-right"), label);
        assert.ok(!html.includes("counter(page"), label);
        assert.match(html, /@top-left\{ content:"ИРП · /, label);
        assert.match(html, /@page :first\{[^}]*@top-left\{ content:none;/, label);
      }
    }
  });

  test("черновик и на согласовании: заметная метка в шапке, без «утверждён»", () => {
    for (const [status, mark] of [
      ["DRAFT", "ЧЕРНОВИК"],
      ["IN_REVIEW", "НА СОГЛАСОВАНИИ"],
    ] as const) {
      const html = buildCallSheetHtml(model, { stamp: { status, version: 3 } });
      assert.ok(html.includes(`<span class="stamp">${mark}</span>`), mark);
      assert.ok(!html.includes("утверждён"), status);
      assert.match(html, /версия 3/);
      assert.ok(!/opacity|rotate\(/.test(html.slice(html.indexOf(".head .stamp"), html.indexOf(".head .stamp") + 300)), "не водяной знак");
    }
    // Вызывной ещё не создан — черновик без версии.
    const none = buildCallSheetHtml(model, { stamp: { status: "DRAFT", version: null } });
    assert.ok(none.includes(">ЧЕРНОВИК<"));
    assert.ok(!/версия \d/.test(none));
  });

  test("Excel: та же метка и версия", () => {
    const text = (stamp: Parameters<typeof buildCallSheetWorkbook>[1]) => {
      const sheet = buildCallSheetWorkbook(model, stamp).worksheets[0]!;
      const values: string[] = [];
      sheet.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value))));
      return values.join("\n");
    };
    assert.ok(text({ status: "DRAFT", version: 1 }).includes("ЧЕРНОВИК"));
    const approved = text({ status: "APPROVED", version: 2, approvedAtLabel: "10.09 17:46" });
    assert.ok(approved.includes("версия 2 · утверждён 10.09 17:46"));
    assert.ok(!approved.includes("ЧЕРНОВИК"));
  });

  test("время утверждения — в часовом поясе проекта, «ДД.ММ ЧЧ:ММ»", () => {
    const at = new Date("2026-09-10T14:46:00Z");
    assert.equal(formatApprovedAt(at, "Europe/Moscow"), "10.09 17:46");
    assert.equal(formatApprovedAt(at, "Asia/Vladivostok"), "11.09 00:46");
    assert.equal(stampVersion(undefined), null);
  });
});

// ---- Права ----

describe("право «Вызывные — утверждение»", () => {
  test("раздел матрицы — только «Доступ»", () => {
    assert.equal(isSectionFlagAllowed("callsheet_approve", "access"), true);
    for (const flag of ["read", "create", "update", "delete", "financeRead", "financeWrite"] as const) {
      assert.equal(isSectionFlagAllowed("callsheet_approve", flag), false, flag);
    }
    const matrix = normalizePermissionMatrix({
      ...buildViewerMatrix(),
      callsheet_approve: fullSectionPermissions(),
    });
    assert.deepEqual(
      Object.entries(matrix.callsheet_approve).filter(([, v]) => v).map(([k]) => k),
      ["access"],
    );
    assert.equal(hasPermission(matrix, "callsheet:approve"), true);
  });

  test("новые проекты: «Продюсер» — да, «Наблюдатель» — нет; старые роли без раздела — нет", () => {
    assert.equal(hasPermission(buildFullMatrix(), "callsheet:approve"), true);
    assert.equal(hasPermission(buildViewerMatrix(), "callsheet:approve"), false);
    assert.equal(hasPermission(parsePermissionMatrix({ schedule: fullSectionPermissions() }), "callsheet:approve"), false);
    // Правка вызывных утверждать не позволяет.
    const editor = parsePermissionMatrix({ schedule: fullSectionPermissions() });
    assert.equal(hasPermission(editor, "callsheet:write"), true);
    assert.equal(hasPermission(editor, "callsheet:approve"), false);
  });

  test("миграция данных — только системному «Продюсеру», остальные флаги выключены, повторно не трогает", () => {
    const dir = path.join(process.cwd(), "prisma/migrations");
    const name = readdirSync(dir).find((d) => d.endsWith("_call_sheet_status_versions"));
    assert.ok(name);
    const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
    assert.doesNotMatch(sql, /\bDROP\b|\bDELETE FROM\b|\bTRUNCATE\b/i, "только добавление");
    const update = sql.slice(sql.indexOf('UPDATE "ProjectRoleDefinition"'));
    assert.ok(update.includes("'callsheet_approve'"));
    assert.ok(update.includes(`'access', r."isSystem" AND r."name" = 'Продюсер'`));
    for (const flag of ["read", "create", "update", "delete", "financeRead", "financeWrite", "financeUnlock"]) {
      assert.ok(update.includes(`'${flag}', false`), flag);
    }
    assert.ok(update.includes(`r."permissions"->'callsheet_approve' IS NULL`), "повторно не трогает");
    assert.match(sql, /CREATE TABLE "CallSheetApprovedVersion"/);
    assert.match(sql, /"revision" INTEGER NOT NULL DEFAULT 0/);
    assert.match(sql, /"version" INTEGER NOT NULL DEFAULT 1/);
  });
});
