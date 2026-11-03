import assert from "node:assert/strict";
import nodeModule from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";
import { startCloudStub, type CloudStub } from "../../../../e2e/cloud-stub/server";
import {
  BUDGET_FOLDER_KEYS,
  budgetDepartmentFolderKey,
  DRIVE_GRANT_ROLE,
  foreignFolderPermissions,
  PROJECT_FOLDER_KEYS,
  type ProjectFolderTarget,
} from "@/features/cloud/lib/drive-access-rules";
import {
  createDrivePermission,
  listDrivePermissions,
  putGoogleSheetFromXlsx,
} from "@/features/cloud/lib/google-drive-api";

// project-drive-folders.ts — серверный модуль ("server-only"): берём его с условием react-server.
type ResolveContext = { conditions: string[] };
type RegisterHooks = (hooks: {
  resolve: (
    specifier: string,
    context: ResolveContext,
    nextResolve: (specifier: string, context: ResolveContext) => unknown,
  ) => unknown;
}) => void;
(nodeModule as unknown as { registerHooks: RegisterHooks }).registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return nextResolve(specifier, { ...context, conditions: [...context.conditions, "react-server"] });
    }
    return nextResolve(specifier, context);
  },
});

/**
 * Папки смет на диске проекта против настоящей заглушки Google (база не нужна — строки
 * `DriveFolder` «пишутся» в память теста): цепочки «Сметы / Сводная» и «Сметы / Цеха / <Цех>»,
 * доступы только у конечных папок, переименование цеха, чужие доступы, запрет копирования у файла.
 */

type Folders = typeof import("@/features/cloud/lib/project-drive-folders");
let ensureProjectFolderChain: Folders["ensureProjectFolderChain"];

const APP = "http://app.test";
let stub: CloudStub;
let token: string;

type StubFile = { id: string; name: string; mimeType: string; parents: string[]; copyRequiresWriterPermission: boolean };
type StubState = { google: { files: StubFile[] } };

const control = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${stub.url}/__stub${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as T;
};

async function login() {
  const redirectUri = `${APP}/api/cloud/google/callback`;
  const q = new URLSearchParams({ client_id: "cid", redirect_uri: redirectUri, response_type: "code", state: "s" });
  const res = await fetch(`${stub.googleUrl}/o/oauth2/v2/auth?${q}`, { redirect: "manual" });
  const code = new URL(res.headers.get("location") ?? "").searchParams.get("code");
  assert.ok(code);
  const tokenRes = await fetch(`${stub.googleUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: "cid",
      client_secret: "secret",
    }),
  });
  return ((await tokenRes.json()) as { access_token: string }).access_token;
}

/** Поддельная база для цепочки папок: `driveFolder` и `department` в памяти. */
function memoryDb(departments: Map<string, string>) {
  const rows = new Map<string, { id: string; key: string; externalId: string; webUrl: string | null; departmentId: string | null }>();
  let n = 0;
  const db = {
    department: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        departments.has(where.id) ? { id: where.id, name: departments.get(where.id)! } : null,
    },
    driveFolder: {
      findMany: async () => [...rows.values()],
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { projectDriveId_key: { key: string } };
        create: { key: string; externalId: string; webUrl: string | null; departmentId: string | null };
        update: { externalId: string; webUrl: string | null; departmentId: string | null };
      }) => {
        const key = where.projectDriveId_key.key;
        const prev = rows.get(key);
        const row = prev ? { ...prev, ...update } : { id: `row-${++n}`, ...create };
        rows.set(key, row);
        return row;
      },
      findUniqueOrThrow: async ({ where }: { where: { projectDriveId_key: { key: string } } }) => {
        const row = rows.get(where.projectDriveId_key.key);
        if (!row) throw new Error("no row");
        return row;
      },
    },
  };
  return { db: db as unknown as Parameters<typeof ensureProjectFolderChain>[0], rows };
}

const ART = "dept-art";
let departments: Map<string, string>;
let mem: ReturnType<typeof memoryDb>;

function ensure(target: ProjectFolderTarget) {
  return ensureProjectFolderChain(mem.db, token, {
    projectId: "p1",
    driveId: "drive-1",
    projectName: "Фильм",
    target,
  });
}

async function files() {
  return (await control<StubState>("/state")).google.files;
}

async function byKey(key: string) {
  const row = mem.rows.get(key);
  assert.ok(row, key);
  const file = (await files()).find((f) => f.id === row.externalId);
  assert.ok(file, key);
  return file;
}

before(async () => {
  stub = await startCloudStub({ port: 0, appOrigin: APP });
  process.env.CLOUD_STUB_GOOGLE_URL = stub.googleUrl;
  ({ ensureProjectFolderChain } = await import("@/features/cloud/lib/project-drive-folders"));
});

after(async () => {
  delete process.env.CLOUD_STUB_GOOGLE_URL;
  await stub.close();
});

beforeEach(async () => {
  await control("/reset", {});
  token = await login();
  departments = new Map([[ART, "Художественный"]]);
  mem = memoryDb(departments);
});

describe("цепочки папок смет", () => {
  test("«Сметы / Сводная» и «Сметы / Цеха / <Цех>» рядом с «Вызывными», у каждой ветки свои «Цеха»", async () => {
    const summary = await ensure({ kind: "budget-summary" });
    const dept = await ensure({ kind: "budget-department", departmentId: ART });
    await ensure({ kind: "department", departmentId: ART });
    assert.equal(summary.outcome, "created");
    assert.equal(dept.departmentName, "Художественный");

    const root = await byKey(PROJECT_FOLDER_KEYS.root);
    const budgets = await byKey(BUDGET_FOLDER_KEYS.budgets);
    const budgetDepts = await byKey(BUDGET_FOLDER_KEYS.departments);
    const sum = await byKey(BUDGET_FOLDER_KEYS.summary);
    const bArt = await byKey(budgetDepartmentFolderKey(ART));
    const callSheets = await byKey(PROJECT_FOLDER_KEYS.callSheets);
    const csDepts = await byKey(PROJECT_FOLDER_KEYS.departments);

    assert.equal(root.name, "PELENA · Фильм");
    assert.deepEqual([budgets.name, budgets.parents], ["Сметы", [root.id]]);
    assert.deepEqual([sum.name, sum.parents], ["Сводная", [budgets.id]]);
    assert.deepEqual([budgetDepts.name, budgetDepts.parents], ["Цеха", [budgets.id]]);
    assert.deepEqual([bArt.name, bArt.parents], ["Художественный", [budgetDepts.id]]);
    assert.deepEqual(callSheets.parents, [root.id]);
    assert.notEqual(csDepts.id, budgetDepts.id, "папки «Цеха» вызывных и смет — разные");
    assert.equal(mem.rows.get(budgetDepartmentFolderKey(ART))?.departmentId, ART);
    assert.equal(mem.rows.get(BUDGET_FOLDER_KEYS.summary)?.departmentId, null);
  });

  test("повторно — те же папки; цеха нет — отказ «Цех не найден»", async () => {
    const first = await ensure({ kind: "budget-department", departmentId: ART });
    const again = await ensure({ kind: "budget-department", departmentId: ART });
    assert.equal(again.outcome, "existing");
    assert.equal(again.externalId, first.externalId);
    await assert.rejects(ensure({ kind: "budget-department", departmentId: "gone" }), /Цех не найден/);
  });

  test("цех переименовали — папка сметы цеха догоняет имя при следующей выгрузке", async () => {
    await ensure({ kind: "budget-department", departmentId: ART });
    departments.set(ART, "Художники");
    await ensure({ kind: "budget-department", departmentId: ART });
    assert.equal((await byKey(budgetDepartmentFolderKey(ART))).name, "Художники");
  });
});

describe("доступы — только у конечных папок", () => {
  test("у PELENA…, «Сметы», «Сметы / Цеха» — только владелец, даже после выдач конечным папкам", async () => {
    await ensure({ kind: "budget-summary" });
    await ensure({ kind: "budget-department", departmentId: ART });
    for (const key of [BUDGET_FOLDER_KEYS.summary, budgetDepartmentFolderKey(ART)]) {
      const externalId = mem.rows.get(key)!.externalId;
      await createDrivePermission(token, externalId, {
        email: "producer@gmail.com",
        role: DRIVE_GRANT_ROLE,
        sendNotificationEmail: true,
      });
    }
    for (const key of [PROJECT_FOLDER_KEYS.root, BUDGET_FOLDER_KEYS.budgets, BUDGET_FOLDER_KEYS.departments]) {
      const list = await listDrivePermissions(token, mem.rows.get(key)!.externalId);
      assert.deepEqual(list.map((p) => p.role), ["owner"], key);
    }
  });

  test("чужие доступы: ручной доступ человеку и «по ссылке» видны, выдачи системы — нет", async () => {
    await ensure({ kind: "budget-summary" });
    await ensure({ kind: "budget-department", departmentId: ART });
    const sum = mem.rows.get(BUDGET_FOLDER_KEYS.summary)!.externalId;
    const budgets = mem.rows.get(BUDGET_FOLDER_KEYS.budgets)!.externalId;
    const ours = await createDrivePermission(token, sum, {
      email: "producer@gmail.com",
      role: DRIVE_GRANT_ROLE,
      sendNotificationEmail: true,
    });
    await control(`/google/files/${sum}/permissions`, { email: "friend@gmail.com", role: "writer" });
    await control(`/google/files/${budgets}/permissions`, { type: "anyone", role: "reader" });

    const sumForeign = foreignFolderPermissions(await listDrivePermissions(token, sum), [ours.permissionId]);
    assert.deepEqual(sumForeign.map((p) => p.email), ["friend@gmail.com"]);
    const budgetsForeign = foreignFolderPermissions(await listDrivePermissions(token, budgets), []);
    assert.deepEqual(budgetsForeign.map((p) => [p.type, p.email]), [["anyone", null]]);
  });
});

describe("запрет скачивания и копирования у файла сметы (решение 10)", () => {
  const XLSX = Buffer.from("PK\u0003\u0004 fake xlsx", "latin1");

  for (const mode of ["update", "recreate"] as const) {
    test(`${mode}: флаг есть у нового файла и остаётся после замены`, async () => {
      const dept = await ensure({ kind: "budget-department", departmentId: ART });
      const first = await putGoogleSheetFromXlsx(
        token,
        { name: "Смета · Художественный · версия 1 (утверждена)", parentId: dept.externalId, content: XLSX, restrictCopy: true },
        mode,
      );
      const second = await putGoogleSheetFromXlsx(
        token,
        {
          existingFileId: first.id,
          name: "Смета · Художественный · версия 2 (утверждена)",
          parentId: dept.externalId,
          content: XLSX,
          restrictCopy: true,
        },
        mode,
      );
      assert.equal(second.outcome, mode === "update" ? "replaced" : "recreated");
      const all = await files();
      const file = all.find((f) => f.id === second.id)!;
      assert.equal(file.copyRequiresWriterPermission, true);
      assert.equal(file.name, "Смета · Художественный · версия 2 (утверждена)");
    });
  }

  test("заглушка как Google: замена без поля флаг не снимает", async () => {
    const dept = await ensure({ kind: "budget-department", departmentId: ART });
    const first = await putGoogleSheetFromXlsx(
      token,
      { name: "Смета", parentId: dept.externalId, content: XLSX, restrictCopy: true },
      "update",
    );
    await putGoogleSheetFromXlsx(token, { existingFileId: first.id, name: "Смета 2", parentId: dept.externalId, content: XLSX }, "update");
    assert.equal((await files()).find((f) => f.id === first.id)!.copyRequiresWriterPermission, true);
  });

  test("вызывной (без restrictCopy) — флага нет", async () => {
    const common = await ensure({ kind: "common" });
    const put = await putGoogleSheetFromXlsx(token, { name: "Вызывной", parentId: common.externalId, content: XLSX }, "update");
    assert.equal((await files()).find((f) => f.id === put.id)!.copyRequiresWriterPermission, false);
  });
});
