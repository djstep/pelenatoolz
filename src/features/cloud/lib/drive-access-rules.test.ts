import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  assertShareableFolderKey,
  departmentFolderKey,
  desiredFolderGrants,
  diffFolderGrants,
  grantEmailFor,
  isKnownGoogleEmail,
  isShareableFolderKey,
  profileDriveEmailNotice,
  PROJECT_FOLDER_KEYS,
  type AccessFolder,
  type AccessMember,
  type StoredGrant,
} from "@/features/cloud/lib/drive-access-rules";

const COMMON: AccessFolder = { id: "f-common", key: "common", departmentId: null };
const ART: AccessFolder = { id: "f-art", key: departmentFolderKey("d-art"), departmentId: "d-art" };
const SOUND: AccessFolder = { id: "f-sound", key: departmentFolderKey("d-sound"), departmentId: "d-sound" };
const ROOT: AccessFolder = { id: "f-root", key: "root", departmentId: null };
const CALLSHEETS: AccessFolder = { id: "f-cs", key: "callsheets", departmentId: null };
const DEPARTMENTS: AccessFolder = { id: "f-deps", key: "departments", departmentId: null };

function member(id: string, patch: Partial<AccessMember> = {}): AccessMember {
  return {
    userId: `u-${id}`,
    membershipId: `m-${id}`,
    status: "ACTIVE",
    isProducer: false,
    canReadCallSheets: true,
    email: `${id}@login.test`,
    googleEmail: null,
    ...patch,
  };
}

const PRODUCER = member("producer", { isProducer: true });
const ART_HEAD = member("art-head");
const NO_CALLSHEETS = member("accountant", { canReadCallSheets: false });
const INVITED = member("invited", { status: "INVITED" });
const REMOVED = member("removed", { status: "REMOVED" });

const HEADS = [{ departmentId: "d-art", membershipId: ART_HEAD.membershipId }];

function grants(input: Partial<Parameters<typeof desiredFolderGrants>[0]> = {}) {
  return desiredFolderGrants({
    folders: [COMMON, ART, SOUND],
    members: [PRODUCER, ART_HEAD, NO_CALLSHEETS, INVITED, REMOVED],
    departmentHeads: HEADS,
    driveAccountEmail: "drive@company.test",
    ...input,
  });
}

function who(list: ReturnType<typeof grants>, folderId: string) {
  return list.filter((g) => g.folderId === folderId).map((g) => g.userId).sort();
}

describe("кому какая папка", () => {
  test("«Общая» — активные участники с просмотром вызывных", () => {
    assert.deepEqual(who(grants(), COMMON.id), ["u-art-head", "u-producer"]);
  });

  test("папка цеха — главы этого цеха и продюсеры", () => {
    const list = grants();
    assert.deepEqual(who(list, ART.id), ["u-art-head", "u-producer"]);
    assert.deepEqual(who(list, SOUND.id), ["u-producer"], "глава «Художественного» не видит «Звук»");
  });

  test("продюсер получает папку цеха и без просмотра вызывных", () => {
    const producer = member("p2", { isProducer: true, canReadCallSheets: false });
    const list = grants({ members: [producer] });
    assert.deepEqual(who(list, COMMON.id), []);
    assert.deepEqual(who(list, ART.id), ["u-p2"]);
  });

  test("роль без вызывных — ничего (если не глава)", () => {
    assert.equal(grants().some((g) => g.userId === NO_CALLSHEETS.userId), false);
  });

  test("глава цеха без просмотра вызывных — только папка своего цеха", () => {
    const head = member("head-nocs", { canReadCallSheets: false });
    const list = grants({
      members: [head],
      departmentHeads: [{ departmentId: "d-sound", membershipId: head.membershipId }],
    });
    assert.deepEqual(list.map((g) => g.folderId), [SOUND.id]);
  });

  test("приглашённый и удалённый — ничего, даже если записаны главами", () => {
    const list = grants({
      departmentHeads: [
        ...HEADS,
        { departmentId: "d-art", membershipId: INVITED.membershipId },
        { departmentId: "d-art", membershipId: REMOVED.membershipId },
      ],
    });
    assert.equal(list.some((g) => g.userId === INVITED.userId || g.userId === REMOVED.userId), false);
  });

  test("почта: «Почта для Google», иначе почта входа", () => {
    assert.equal(grantEmailFor({ email: "Login@Mail.test", googleEmail: null }), "login@mail.test");
    assert.equal(grantEmailFor({ email: "login@mail.test", googleEmail: "  " }), "login@mail.test");
    assert.equal(grantEmailFor({ email: "login@mail.test", googleEmail: " Me@Gmail.com " }), "me@gmail.com");
    const list = grants({ members: [member("g", { googleEmail: "G@gmail.com" })] });
    assert.deepEqual([...new Set(list.map((g) => g.email))], ["g@gmail.com"]);
  });

  test("аккаунт самого диска пропускается — он владелец папок", () => {
    const keeper = member("keeper", { isProducer: true, googleEmail: "Drive@Company.test" });
    const list = grants({ members: [keeper, PRODUCER] });
    assert.equal(list.some((g) => g.userId === keeper.userId), false);
    assert.deepEqual(who(list, COMMON.id), ["u-producer"]);
  });

  test("одна почта на папку — один доступ", () => {
    const a = member("a", { googleEmail: "same@gmail.com" });
    const b = member("b", { googleEmail: "SAME@gmail.com" });
    assert.deepEqual(who(grants({ members: [a, b] }), COMMON.id), ["u-a"]);
  });

  test("цех удалили (departmentId обнулился) — у папки доступов нет", () => {
    const orphan: AccessFolder = { ...ART, departmentId: null };
    assert.deepEqual(who(grants({ folders: [orphan] }), orphan.id), []);
  });

  test("root / callsheets / departments — никому, даже продюсеру", () => {
    const list = grants({ folders: [ROOT, CALLSHEETS, DEPARTMENTS, COMMON] });
    assert.deepEqual([...new Set(list.map((g) => g.folderId))], [COMMON.id]);
  });
});

describe("риск 9: доступ — только конечным папкам", () => {
  test("ключи", () => {
    assert.equal(isShareableFolderKey(PROJECT_FOLDER_KEYS.common), true);
    assert.equal(isShareableFolderKey(departmentFolderKey("d1")), true);
    for (const key of ["root", "callsheets", "departments", "dept:", "budgets", ""]) {
      assert.equal(isShareableFolderKey(key), false, key);
      assert.throws(() => assertShareableFolderKey(key), /не выдаётся/);
    }
    assert.doesNotThrow(() => assertShareableFolderKey("common"));
  });

  test("выдача доступа в коде идёт только через проверку ключа", () => {
    // Единственный вызов createDrivePermission — в синхронизации, и сразу перед ним проверка ключа.
    const src = readFileSync(new URL("./drive-access-sync.ts", import.meta.url), "utf8");
    const calls = src.split("createDrivePermission(").length - 1;
    assert.equal(calls, 1, "createDrivePermission вызывается ровно в одном месте");
    const before = src.slice(0, src.indexOf("createDrivePermission(accessToken"));
    const tail = before.slice(before.lastIndexOf("async function"));
    assert.match(tail, /assertShareableFolderKey\(/);
  });
});

function row(patch: Partial<StoredGrant> & Pick<StoredGrant, "id" | "folderId" | "userId">): StoredGrant {
  return { email: `${patch.userId}@x.test`, permissionId: `p-${patch.userId}`, status: "OK", ...patch };
}

describe("разница «выдано / нужно»", () => {
  const want = (folderId: string, userId: string, email = `${userId}@x.test`) => ({ folderId, userId, email });

  test("всё совпадает — ничего не делать", () => {
    const ops = diffFolderGrants({
      desired: [want("f1", "u1")],
      stored: [row({ id: "g1", folderId: "f1", userId: "u1" })],
    });
    assert.deepEqual(ops, []);
  });

  test("новый — выдать; лишний — снять", () => {
    const ops = diffFolderGrants({
      desired: [want("f1", "u1")],
      stored: [row({ id: "g2", folderId: "f1", userId: "u2" })],
    });
    assert.deepEqual(ops, [
      { kind: "add", folderId: "f1", userId: "u1", email: "u1@x.test", grantId: null },
      { kind: "remove", grantId: "g2", folderId: "f1", permissionId: "p-u2" },
    ]);
  });

  test("неудачная выдача — повторить; неудачное снятие нужного — пометить OK", () => {
    const ops = diffFolderGrants({
      desired: [want("f1", "u1"), want("f1", "u2")],
      stored: [
        row({ id: "g1", folderId: "f1", userId: "u1", permissionId: null, status: "FAILED" }),
        row({ id: "g2", folderId: "f1", userId: "u2", status: "PENDING_REMOVE" }),
      ],
    });
    assert.deepEqual(ops, [
      { kind: "add", folderId: "f1", userId: "u1", email: "u1@x.test", grantId: "g1" },
      { kind: "markOk", grantId: "g2" },
    ]);
  });

  test("смена почты — снять старую выдачу и выдать на новую", () => {
    const ops = diffFolderGrants({
      desired: [want("f1", "u1", "new@gmail.com")],
      stored: [row({ id: "g1", folderId: "f1", userId: "u1", email: "old@gmail.com", permissionId: "p-old" })],
    });
    assert.deepEqual(ops, [
      { kind: "regrant", grantId: "g1", folderId: "f1", userId: "u1", email: "new@gmail.com", oldPermissionId: "p-old" },
    ]);
  });

  test("ненужная строка без выдачи у Google — только удалить строку", () => {
    const ops = diffFolderGrants({
      desired: [],
      stored: [row({ id: "g1", folderId: "f1", userId: "u1", permissionId: null, status: "FAILED" })],
    });
    assert.deepEqual(ops, [{ kind: "drop", grantId: "g1" }]);
  });

  test("доступы, выданные руками, не трогаются", () => {
    const google = new Map([
      ["f1", [{ id: "p-u1", email: "u1@x.test" }, { id: "p-manual", email: "friend@gmail.com" }]],
    ]);
    const ops = diffFolderGrants({
      desired: [],
      stored: [row({ id: "g1", folderId: "f1", userId: "u1" })],
      google,
    });
    assert.deepEqual(ops, [{ kind: "remove", grantId: "g1", folderId: "f1", permissionId: "p-u1" }]);
    assert.equal(ops.some((o) => "permissionId" in o && o.permissionId === "p-manual"), false);
  });

  test("нужному человеку уже выдано руками — своего не выдаём", () => {
    const google = new Map([["f1", [{ id: "p-manual", email: "U1@x.test" }]]]);
    const ops = diffFolderGrants({ desired: [want("f1", "u1")], stored: [], google });
    assert.deepEqual(ops, []);
  });

  test("нашу выдачу сняли руками у Google — выдать заново; лишнюю, которой уже нет, — удалить строку", () => {
    const google = new Map([["f1", [] as { id: string; email: string | null }[]]]);
    const ops = diffFolderGrants({
      desired: [want("f1", "u1")],
      stored: [
        row({ id: "g1", folderId: "f1", userId: "u1" }),
        row({ id: "g2", folderId: "f1", userId: "u2" }),
      ],
      google,
    });
    assert.deepEqual(ops, [
      { kind: "add", folderId: "f1", userId: "u1", email: "u1@x.test", grantId: "g1" },
      { kind: "drop", grantId: "g2" },
    ]);
  });

  test("ту же выдачу держит нужная строка (та же почта) — у Google не снимать", () => {
    const ops = diffFolderGrants({
      desired: [want("f1", "u1", "same@gmail.com")],
      stored: [
        row({ id: "g1", folderId: "f1", userId: "u1", email: "same@gmail.com", permissionId: "p-same" }),
        row({ id: "g2", folderId: "f1", userId: "u2", email: "same@gmail.com", permissionId: "p-same" }),
      ],
    });
    assert.deepEqual(ops, [{ kind: "drop", grantId: "g2" }]);
  });
});

describe("почта не Google и подсказка в профиле", () => {
  test("Gmail и проверенная почта Google — Google; остальное — нет", () => {
    assert.equal(isKnownGoogleEmail("a@gmail.com", []), true);
    assert.equal(isKnownGoogleEmail("a@googlemail.com", []), true);
    assert.equal(isKnownGoogleEmail("a@company.ru", ["A@company.ru"]), true);
    assert.equal(isKnownGoogleEmail("a@mail.ru", [null, "b@mail.ru"]), false);
  });

  test("на какую почту выдаётся доступ и расхождение с подключённым Google", () => {
    assert.deepEqual(
      profileDriveEmailNotice({ email: "me@mail.ru", googleEmail: null, connectedGoogleEmail: null }),
      { grantEmail: "me@mail.ru", mismatch: null },
    );
    assert.deepEqual(
      profileDriveEmailNotice({ email: "me@mail.ru", googleEmail: "me@gmial.com", connectedGoogleEmail: "Me@gmail.com" }),
      { grantEmail: "me@gmial.com", mismatch: "me@gmail.com" },
    );
    assert.deepEqual(
      profileDriveEmailNotice({ email: "me@mail.ru", googleEmail: "ME@gmail.com", connectedGoogleEmail: "me@gmail.com" }),
      { grantEmail: "me@gmail.com", mismatch: null },
    );
  });
});
