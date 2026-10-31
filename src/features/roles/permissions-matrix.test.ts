import assert from "node:assert/strict";
import nodeModule from "node:module";
import { before, describe, test } from "node:test";
import {
  buildEmptyMatrix,
  buildFullMatrix,
  buildViewerMatrix,
  can,
  fullSectionPermissions,
  normalizePermissionMatrix,
  parsePermissionMatrix,
  PERMISSION_SECTIONS,
} from "@/features/roles/permissions-matrix";

// role-rules.ts — серверный модуль ("server-only"): как и Next на сервере,
// берём его с условием react-server (пустой файл вместо ошибки).
// registerHooks есть в Node 22.15+, а типы в проекте — от Node 20.
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
let isPermissionSubset: typeof import("@/features/roles/role-rules").isPermissionSubset;

// Волна 2б, задача 1: «Снятие фиксации платежей» есть только у «Финансов».

const OTHER_SECTIONS = PERMISSION_SECTIONS.filter((s) => s.id !== "finance");

function matrixWithUnlockEverywhere() {
  const matrix = buildEmptyMatrix();
  for (const s of PERMISSION_SECTIONS) {
    matrix[s.id] = fullSectionPermissions();
  }
  return matrix;
}

describe("normalizePermissionMatrix", () => {
  test("financeUnlock остаётся только у finance", () => {
    const out = normalizePermissionMatrix(matrixWithUnlockEverywhere());
    assert.equal(out.finance.financeUnlock, true);
    for (const s of OTHER_SECTIONS) {
      assert.equal(out[s.id].financeUnlock, false, s.id);
    }
  });

  test("остальные флаги не теряются", () => {
    const out = normalizePermissionMatrix(matrixWithUnlockEverywhere());
    assert.equal(out.scenes.update, true);
    assert.equal(out.actors.financeWrite, true);
    assert.equal(out.finance.financeRead, true);
    // smeta_all — только доступ и просмотр, как раньше.
    assert.equal(out.smeta_all.read, true);
    assert.equal(out.smeta_all.update, false);
  });

  test("повторная нормализация ничего не меняет", () => {
    const once = normalizePermissionMatrix(matrixWithUnlockEverywhere());
    assert.deepEqual(normalizePermissionMatrix(once), once);
  });

  test("старая роль в базе: при чтении financeUnlock вне finance выключен", () => {
    const parsed = parsePermissionMatrix({
      scenes: { access: true, read: true, financeUnlock: true },
      finance: { access: true, financeUnlock: true },
    });
    assert.equal(parsed.scenes.financeUnlock, false);
    assert.equal(parsed.scenes.read, true);
    assert.equal(parsed.finance.financeUnlock, true);
    assert.equal(can(parsed, "finance", "financeUnlock"), true);
  });
});

describe("шаблоны ролей", () => {
  test("продюсер: financeUnlock только у finance", () => {
    const full = buildFullMatrix();
    assert.equal(full.finance.financeUnlock, true);
    for (const s of OTHER_SECTIONS) {
      assert.equal(full[s.id].financeUnlock, false, s.id);
    }
  });

  test("наблюдатель: financeUnlock нигде", () => {
    const viewer = buildViewerMatrix();
    for (const s of PERMISSION_SECTIONS) {
      assert.equal(viewer[s.id].financeUnlock, false, s.id);
    }
  });
});

describe("isPermissionSubset и financeUnlock", () => {
  before(async () => {
    ({ isPermissionSubset } = await import("@/features/roles/role-rules"));
  });

  const actor = {
    members: { access: true, read: true, update: true, delete: true },
    scenes: { access: true, read: true, update: true },
  };

  test("старый financeUnlock у другого раздела в роли не мешает", () => {
    const target = {
      scenes: { access: true, read: true, financeUnlock: true },
    };
    assert.equal(isPermissionSubset(target, actor), true);
  });

  test("старый financeUnlock у другого раздела у редактора не даёт права", () => {
    const actorWithStale = {
      ...actor,
      scenes: { ...actor.scenes, financeUnlock: true },
    };
    const target = { finance: { access: true, financeUnlock: true } };
    assert.equal(isPermissionSubset(target, actorWithStale), false);
  });

  test("financeUnlock у finance сравнивается как раньше", () => {
    const target = { finance: { access: true, financeUnlock: true } };
    assert.equal(isPermissionSubset(target, actor), false);
    assert.equal(
      isPermissionSubset(target, {
        ...actor,
        finance: { access: true, financeUnlock: true },
      }),
      true,
    );
  });

  test("прочие права шире своих — по-прежнему отказ", () => {
    const target = { scenes: { access: true, delete: true } };
    assert.equal(isPermissionSubset(target, actor), false);
  });
});
