import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nodeModule from "node:module";
import { before, describe, test } from "node:test";

// project-drive-service.ts — серверный модуль ("server-only"): берём его с условием react-server.
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
      return nextResolve(specifier, {
        ...context,
        conditions: [...context.conditions, "react-server"],
      });
    }
    return nextResolve(specifier, context);
  },
});

type Service = typeof import("@/features/cloud/lib/project-drive-service");
let detachProjectDriveIfKeeperLeft: Service["detachProjectDriveIfKeeperLeft"];
before(async () => {
  ({ detachProjectDriveIfKeeperLeft } = await import("@/features/cloud/lib/project-drive-service"));
});

const PRODUCER = { isSystem: true, name: "Продюсер" };
const DIRECTOR = { isSystem: true, name: "Режиссёр" };

/** Поддельная транзакция: только то, что трогает авто-отключение. */
function fakeTx(input: {
  drive: Record<string, unknown> | null;
  membership: { status: "ACTIVE" | "REMOVED"; role: { isSystem: boolean; name: string } } | null;
}) {
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const audit: Array<Record<string, unknown>> = [];
  const tx = {
    projectDrive: {
      findFirst: async () => input.drive,
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(args);
        return { ...input.drive, ...args.data };
      },
    },
    projectMembership: {
      findFirst: async () =>
        input.membership && { id: "m-keeper", ...input.membership, user: { name: "Анна Хранитель" } },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        audit.push(args.data);
        return args.data;
      },
    },
  };
  return { tx: tx as unknown as Parameters<Service["detachProjectDriveIfKeeperLeft"]>[0], updates, audit };
}

const DRIVE = {
  id: "d-1",
  projectId: "p-1",
  provider: "GOOGLE_DRIVE",
  status: "ACTIVE",
  keeperMembershipId: "m-keeper",
  accountEmail: "keeper@gmail.com",
  accountSubject: "sub-1",
  accessToken: "enc-access",
  refreshToken: "enc-refresh",
};

const call = (tx: Parameters<Service["detachProjectDriveIfKeeperLeft"]>[0]) =>
  detachProjectDriveIfKeeperLeft(tx, { projectId: "p-1", membershipId: "m-keeper", actorUserId: "u-owner" });

describe("авто-отключение диска проекта в транзакции изменения участия", () => {
  test("хранителя удалили — диск DETACHED, токены стёрты, журнал без почты, токены — на отзыв после", async () => {
    const { tx, updates, audit } = fakeTx({ drive: DRIVE, membership: { status: "REMOVED", role: PRODUCER } });
    const released = await call(tx);

    assert.equal(updates.length, 1);
    const data = updates[0].data;
    assert.equal(data.status, "DETACHED");
    assert.equal(data.accessToken, null);
    assert.equal(data.refreshToken, null);
    assert.equal(data.detachReason, "keeper_left");

    assert.equal(audit.length, 1);
    assert.equal(audit[0].entityType, "project_drive");
    assert.equal(audit[0].projectId, "p-1");
    assert.equal(audit[0].userId, "u-owner");
    assert.match(String(audit[0].summary), /Диск проекта отключён: хранитель «Анна Хранитель» больше не продюсер/);
    assert.doesNotMatch(JSON.stringify(audit[0]), /@/);

    assert.deepEqual(released, {
      provider: "GOOGLE_DRIVE",
      accountSubject: "sub-1",
      accountEmail: "keeper@gmail.com",
      accessToken: "enc-access",
      refreshToken: "enc-refresh",
    });
  });

  test("хранителю сменили роль на не продюсерскую — тоже отключение", async () => {
    const { tx, updates } = fakeTx({ drive: DRIVE, membership: { status: "ACTIVE", role: DIRECTOR } });
    assert.ok(await call(tx));
    assert.equal(updates[0].data.status, "DETACHED");
  });

  test("обычная роль с именем «Продюсер» — не продюсер: отключение", async () => {
    const { tx, updates } = fakeTx({
      drive: DRIVE,
      membership: { status: "ACTIVE", role: { isSystem: false, name: "Продюсер" } },
    });
    assert.ok(await call(tx));
    assert.equal(updates.length, 1);
  });

  test("хранитель остался активным продюсером — диск не трогаем", async () => {
    const { tx, updates, audit } = fakeTx({ drive: DRIVE, membership: { status: "ACTIVE", role: PRODUCER } });
    assert.equal(await call(tx), null);
    assert.equal(updates.length, 0);
    assert.equal(audit.length, 0);
  });

  test("участник — не хранитель активного диска — диск не трогаем", async () => {
    const { tx, updates } = fakeTx({ drive: null, membership: { status: "REMOVED", role: PRODUCER } });
    assert.equal(await call(tx), null);
    assert.equal(updates.length, 0);
  });
});

describe("смена роли и удаление участника: отключение в той же транзакции, отзыв — после", () => {
  const actions = readFileSync(new URL("../../projects/actions.ts", import.meta.url), "utf8");

  for (const name of ["updateMemberRoleAction", "removeMemberAction"]) {
    test(name, () => {
      const start = actions.indexOf(`export async function ${name}(`);
      const end = actions.indexOf("export async function", start + 10);
      const body = actions.slice(start, end);
      const tx = body.indexOf("prisma.$transaction(");
      const detach = body.indexOf("detachProjectDriveIfKeeperLeft(tx,");
      const txEnd = body.indexOf("  });", detach);
      const revoke = body.indexOf("revokeProjectDriveTokens(");
      assert.ok(tx > 0 && detach > tx, "отключение диска — внутри транзакции");
      assert.ok(revoke > txEnd, "отзыв у Google — после транзакции");
    });
  }

  test("передача владения диск не трогает", () => {
    const start = actions.indexOf("export async function transferOwnershipAction(");
    const end = actions.indexOf("export async function", start + 10);
    assert.doesNotMatch(actions.slice(start, end), /ProjectDrive|projectDrive/);
  });
});
