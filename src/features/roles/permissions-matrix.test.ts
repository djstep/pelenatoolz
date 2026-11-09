import assert from "node:assert/strict";
import nodeModule from "node:module";
import { before, describe, test } from "node:test";
import { hasPermission } from "@/features/memberships/permissions";
import {
  buildEmptyMatrix,
  buildFullMatrix,
  buildNewRoleMatrix,
  buildViewerMatrix,
  can,
  emptySectionPermissions,
  fullSectionPermissions,
  normalizePermissionMatrix,
  isSectionFlagAllowed,
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

// Добивка задачи 1: фин. условия есть только у ставок и у «Финансов».

const FINANCE_FLAG_SECTIONS = ["actors", "locations", "elements", "finance"];
const NO_FINANCE_SECTIONS = PERMISSION_SECTIONS.filter(
  (s) => !FINANCE_FLAG_SECTIONS.includes(s.id),
);

describe("normalizePermissionMatrix: фин. условия", () => {
  test("financeRead/financeWrite остаются только у ставок; у finance — только просмотр", () => {
    const out = normalizePermissionMatrix(matrixWithUnlockEverywhere());
    for (const id of ["actors", "locations", "elements"] as const) {
      assert.equal(out[id].financeRead, true, id);
      assert.equal(out[id].financeWrite, true, id);
    }
    assert.equal(out.finance.financeRead, true);
    assert.equal(out.finance.financeWrite, false);
    for (const s of NO_FINANCE_SECTIONS) {
      assert.equal(out[s.id].financeRead, false, s.id);
      assert.equal(out[s.id].financeWrite, false, s.id);
    }
  });

  test("старая роль в базе: фин. условия у договоров не читаются", () => {
    const parsed = parsePermissionMatrix({
      contracts: { access: true, read: true, financeRead: true, financeWrite: true },
      actors: { access: true, financeRead: true },
    });
    assert.equal(parsed.contracts.financeRead, false);
    assert.equal(parsed.contracts.financeWrite, false);
    assert.equal(parsed.contracts.read, true);
    assert.equal(parsed.actors.financeRead, true);
  });

  test("шаблоны: фин. условия вне ставок и finance выключены", () => {
    for (const m of [buildFullMatrix(), buildViewerMatrix()]) {
      for (const s of NO_FINANCE_SECTIONS) {
        assert.equal(m[s.id].financeRead, false, s.id);
        assert.equal(m[s.id].financeWrite, false, s.id);
      }
    }
    assert.equal(buildFullMatrix().actors.financeWrite, true);
    assert.equal(buildViewerMatrix().actors.financeRead, true);
    assert.equal(buildViewerMatrix().finance.financeRead, true);
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

  test("старые фин. условия у другого раздела в роли не мешают", () => {
    const target = {
      scenes: { access: true, read: true, financeRead: true },
      contracts: { financeWrite: true },
    };
    assert.equal(isPermissionSubset(target, actor), true);
  });

  test("фин. условия актёров сравниваются как раньше", () => {
    const target = { actors: { access: true, financeRead: true } };
    assert.equal(isPermissionSubset(target, actor), false);
    assert.equal(
      isPermissionSubset(target, {
        ...actor,
        actors: { access: true, financeWrite: true },
      }),
      true,
    );
  });

  test("прочие права шире своих — по-прежнему отказ", () => {
    const target = { scenes: { access: true, delete: true } };
    assert.equal(isPermissionSubset(target, actor), false);
  });
});

describe("«Финансы»: фин. условия — только просмотр", () => {
  function withFinance(flags: Partial<ReturnType<typeof fullSectionPermissions>>) {
    const m = buildEmptyMatrix();
    m.finance = { ...m.finance, access: true, read: true, ...flags };
    return m;
  }

  test("присланное «редактирование» при сохранении роли становится просмотром", () => {
    const out = normalizePermissionMatrix(withFinance({ financeWrite: true }));
    assert.equal(out.finance.financeRead, true);
    assert.equal(out.finance.financeWrite, false);
  });

  test("просмотр без «редактирования» не меняется, без флажков — не появляется", () => {
    assert.equal(normalizePermissionMatrix(withFinance({ financeRead: true })).finance.financeRead, true);
    const none = normalizePermissionMatrix(withFinance({}));
    assert.equal(none.finance.financeRead, false);
    assert.equal(none.finance.financeWrite, false);
  });

  test("роль в базе с «редактированием» читается как просмотр, права те же", () => {
    const raw = { finance: { access: true, read: true, financeRead: true, financeWrite: true } };
    const parsed = parsePermissionMatrix(raw);
    assert.equal(parsed.finance.financeWrite, false);
    assert.equal(can(parsed, "finance", "finance"), true);
  });

  test("правка модуля «Финансы» по-прежнему от «Создания» / «Редактирования»", () => {
    const out = normalizePermissionMatrix(withFinance({ update: true, financeWrite: true }));
    assert.equal(can(out, "finance", "write"), true);
    assert.equal(can(normalizePermissionMatrix(withFinance({ financeWrite: true })), "finance", "write"), false);
  });

  test("у ставок «редактирование» остаётся", () => {
    const m = buildEmptyMatrix();
    m.actors = { ...m.actors, access: true, financeWrite: true };
    assert.equal(normalizePermissionMatrix(m).actors.financeWrite, true);
  });
});

describe("Волна 8: права «Команда»", () => {
  test("продюсеру — просмотр, правка и контакты", () => {
    const m = buildFullMatrix();
    assert.equal(hasPermission(m, "crew:read"), true);
    assert.equal(hasPermission(m, "crew:write"), true);
    assert.equal(hasPermission(m, "crew:contacts"), true);
  });

  test("наблюдателю — только просмотр", () => {
    const m = buildViewerMatrix();
    assert.equal(hasPermission(m, "crew:read"), true);
    assert.equal(hasPermission(m, "crew:write"), false);
    assert.equal(hasPermission(m, "crew:contacts"), false);
  });

  test("новая своя роль — только просмотр команды и календаря", () => {
    const m = buildNewRoleMatrix();
    assert.equal(hasPermission(m, "crew:read"), true);
    assert.equal(hasPermission(m, "crew:write"), false);
    assert.equal(hasPermission(m, "crew:contacts"), false);
    assert.equal(hasPermission(m, "calendar:read"), true);
    assert.equal(hasPermission(m, "calendar:write"), false);
    for (const s of PERMISSION_SECTIONS) {
      if (s.id === "crew" || s.id === "calendar") continue;
      assert.deepEqual(m[s.id], emptySectionPermissions(), s.id);
    }
  });

  test("календарь: продюсер правит, наблюдатель только смотрит", () => {
    const producer = buildFullMatrix();
    assert.equal(hasPermission(producer, "calendar:read"), true);
    assert.equal(hasPermission(producer, "calendar:write"), true);
    const viewer = buildViewerMatrix();
    assert.equal(hasPermission(viewer, "calendar:read"), true);
    assert.equal(hasPermission(viewer, "calendar:write"), false);
  });

  test("календарь: у раздела только «Доступ», «Просмотр» и «Редактирование»", () => {
    assert.equal(isSectionFlagAllowed("calendar", "update"), true);
    assert.equal(isSectionFlagAllowed("calendar", "create"), false);
    assert.equal(isSectionFlagAllowed("calendar", "delete"), false);
    assert.equal(isSectionFlagAllowed("calendar", "financeRead"), false);
  });

  test("календарь: роль без раздела в базе ничего не получает", () => {
    const m = parsePermissionMatrix({ crew: { access: true, read: true } });
    assert.equal(hasPermission(m, "calendar:read"), false);
    assert.equal(hasPermission(m, "calendar:write"), false);
  });

  test("«Контакты» сами по себе не дают просмотр и правку", () => {
    const m = buildEmptyMatrix();
    m.crew_contacts = { ...m.crew_contacts, access: true };
    assert.equal(hasPermission(m, "crew:contacts"), true);
    assert.equal(hasPermission(m, "crew:read"), false);
    assert.equal(hasPermission(m, "crew:write"), false);
  });

  test("в «Команде» нет создания и удаления, в «Контактах» — ничего, кроме доступа", () => {
    const m = normalizePermissionMatrix(matrixWithUnlockEverywhere());
    assert.equal(m.crew.update, true);
    assert.equal(m.crew.create, false);
    assert.equal(m.crew.delete, false);
    assert.equal(m.crew.financeRead, false);
    assert.equal(m.crew_contacts.access, true);
    assert.equal(m.crew_contacts.read, false);
    assert.equal(m.crew_contacts.update, false);
  });

  test("старая роль без разделов команды читается как «выключено»", () => {
    const m = parsePermissionMatrix({ scenes: { access: true, read: true } });
    assert.equal(hasPermission(m, "crew:read"), false);
    assert.equal(hasPermission(m, "crew:contacts"), false);
  });

  test("нельзя выдать «Контакты» шире своих прав", () => {
    const actor = { crew: { access: true, read: true, update: true } };
    assert.equal(isPermissionSubset({ crew_contacts: { access: true } }, actor), false);
    assert.equal(
      isPermissionSubset({ crew_contacts: { access: true } }, {
        ...actor,
        crew_contacts: { access: true },
      }),
      true,
    );
  });
});
