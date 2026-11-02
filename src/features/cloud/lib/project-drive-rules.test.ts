import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canManageProjectDrive,
  canSeeProjectDrive,
  isDriveKeeper,
  keeperStillValid,
  projectDriveAlert,
  projectDriveCleanSlate,
  projectDriveConnectRefusal,
  type ProjectDriveActor,
  type ProjectDriveState,
} from "@/features/cloud/lib/project-drive-rules";

const OWNER = "u-owner";
const actor = (over: Partial<ProjectDriveActor> = {}): ProjectDriveActor => ({
  userId: "u-1",
  membershipId: "m-1",
  isProducer: true,
  ownerUserId: OWNER,
  ...over,
});
const owner = actor({ userId: OWNER, membershipId: "m-owner" });
const active = (keeperMembershipId: string | null): ProjectDriveState => ({ status: "ACTIVE", keeperMembershipId });
const detached = (keeperMembershipId: string | null): ProjectDriveState => ({ status: "DETACHED", keeperMembershipId });

describe("диск проекта — кто подключает", () => {
  test("диска нет: владелец или активный продюсер", () => {
    assert.equal(projectDriveConnectRefusal(actor(), null), null);
    assert.equal(projectDriveConnectRefusal(owner, null), null);
    // Владелец без продюсерской роли (на будущее) — тоже может.
    assert.equal(projectDriveConnectRefusal({ ...owner, isProducer: false }, null), null);
  });

  test("не продюсер и не владелец — отказ; не участник — отказ", () => {
    assert.equal(projectDriveConnectRefusal(actor({ isProducer: false }), null), "not_producer");
    assert.equal(projectDriveConnectRefusal(actor({ membershipId: null }), null), "not_member");
  });

  test("диск отключён — подключает новый любой продюсер (с чистого листа)", () => {
    assert.equal(projectDriveConnectRefusal(actor(), detached("m-old")), null);
  });

  test("диск активен — заменить может только хранитель или владелец", () => {
    assert.equal(projectDriveConnectRefusal(actor({ membershipId: "m-keeper" }), active("m-keeper")), null);
    assert.equal(projectDriveConnectRefusal(owner, active("m-keeper")), null);
    assert.equal(projectDriveConnectRefusal(actor({ membershipId: "m-2" }), active("m-keeper")), "not_keeper");
    assert.equal(projectDriveConnectRefusal(actor({ isProducer: false }), active("m-1")), "not_producer");
  });
});

describe("диск проекта — кто отключает / заменяет", () => {
  test("хранитель и владелец — да; другой продюсер — нет", () => {
    assert.equal(canManageProjectDrive(actor({ membershipId: "m-keeper" }), active("m-keeper")), true);
    assert.equal(canManageProjectDrive(owner, active("m-keeper")), true);
    assert.equal(canManageProjectDrive(actor({ membershipId: "m-2" }), active("m-keeper")), false);
  });

  test("хранитель, переставший быть продюсером, — не хранитель", () => {
    const demoted = actor({ membershipId: "m-keeper", isProducer: false });
    assert.equal(isDriveKeeper(demoted, active("m-keeper")), false);
    assert.equal(canManageProjectDrive(demoted, active("m-keeper")), false);
  });

  test("отключённый или не подключённый диск отключать нечего", () => {
    assert.equal(canManageProjectDrive(owner, detached("m-keeper")), false);
    assert.equal(canManageProjectDrive(owner, null), false);
  });

  test("раздел и плашки видят владелец и продюсеры", () => {
    assert.equal(canSeeProjectDrive(actor()), true);
    assert.equal(canSeeProjectDrive({ ...owner, isProducer: false }), true);
    assert.equal(canSeeProjectDrive(actor({ isProducer: false })), false);
    assert.equal(canSeeProjectDrive(actor({ membershipId: null })), false);
  });
});

describe("авто-отключение: хранитель перестал быть активным продюсером", () => {
  test("удалён, понижен, участие пропало — диск отключается", () => {
    assert.equal(keeperStillValid({ active: false, isProducer: true }), false);
    assert.equal(keeperStillValid({ active: true, isProducer: false }), false);
    assert.equal(keeperStillValid(null), false);
  });

  test("остался активным продюсером (в т. ч. после передачи владения) — диск работает", () => {
    assert.equal(keeperStillValid({ active: true, isProducer: true }), true);
  });
});

describe("замена диска — с чистого листа", () => {
  const withSubject = (state: ProjectDriveState, accountSubject: string | null) => ({ ...state, accountSubject });

  test("первое подключение — отвязывать нечего", () => {
    assert.equal(projectDriveCleanSlate(null, "sub-1"), false);
  });

  test("после отключения — всегда с чистого листа, даже тот же аккаунт", () => {
    assert.equal(projectDriveCleanSlate(withSubject(detached("m-1"), "sub-1"), "sub-1"), true);
  });

  test("активный диск: другой аккаунт — с чистого листа; тот же аккаунт — папки остаются", () => {
    assert.equal(projectDriveCleanSlate(withSubject(active("m-1"), "sub-1"), "sub-2"), true);
    assert.equal(projectDriveCleanSlate(withSubject(active("m-1"), "sub-1"), "sub-1"), false);
    assert.equal(projectDriveCleanSlate(withSubject(active("m-1"), null), null), true);
  });
});

describe("плашка продюсерам", () => {
  const view = (over: Partial<ProjectDriveState & { detachReason: string | null; needsReconnect: boolean }>) => ({
    status: "ACTIVE" as const,
    keeperMembershipId: "m-1",
    detachReason: null,
    needsReconnect: false,
    ...over,
  });

  test("хранитель ушёл — «подключите новый»; отключили руками — без плашки", () => {
    assert.equal(projectDriveAlert(view({ status: "DETACHED", detachReason: "keeper_left" })), "keeper_left");
    assert.equal(projectDriveAlert(view({ status: "DETACHED", detachReason: "disconnected" })), null);
  });

  test("доступ отозван у Google — «нужно переподключить»", () => {
    assert.equal(projectDriveAlert(view({ needsReconnect: true })), "reconnect");
    assert.equal(projectDriveAlert(view({})), null);
    assert.equal(projectDriveAlert(null), null);
  });
});
