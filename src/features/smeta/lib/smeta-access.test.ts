import assert from "node:assert/strict";
import nodeModule from "node:module";
import { before, describe, test } from "node:test";
import { hasPermission } from "@/features/memberships/permissions";
import { parsePermissionMatrix } from "@/features/roles/permissions-matrix";

// smeta-access.ts → role-rules.ts — серверный модуль ("server-only"): берём его с условием
// react-server, как в project-nav-groups.test.ts.
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

let access: typeof import("@/features/smeta/lib/smeta-access");
before(async () => {
  access = await import("@/features/smeta/lib/smeta-access");
});

const PRODUCER = { isSystem: true, name: "Продюсер" };
const OTHER = { isSystem: false, name: "Линейный продюсер" };

/** Контекст из сырых прав роли — как requireProjectContext. */
function ctx(raw: unknown, role = OTHER, headDepartmentIds: string[] = []) {
  const matrix = parsePermissionMatrix(raw);
  return { role, can: (p: Parameters<typeof hasPermission>[1]) => hasPermission(matrix, p), headDepartmentIds };
}

const FINANCE_WRITE = { access: true, read: true, create: true, update: true, delete: true, financeRead: true };

describe("Сметы — вернуть на доработку", () => {
  test("продюсер возвращает любую смету", () => {
    assert.equal(access.canReturnSmeta(ctx({}, PRODUCER), "d1"), true);
  });

  test("с флагом — только видимую смету: все сметы или свой цех", () => {
    const flag = { smeta_return: { access: true } };
    assert.equal(access.canReturnSmeta(ctx(flag), "d1"), false);
    assert.equal(access.canReturnSmeta(ctx({ ...flag, smeta_all: { access: true, read: true } }), "d1"), true);
    assert.equal(access.canReturnSmeta(ctx(flag, OTHER, ["d1"]), "d1"), true);
    assert.equal(access.canReturnSmeta(ctx(flag, OTHER, ["d1"]), "d2"), false);
  });

  test("без флага не возвращает даже со «смотреть все» и правкой финансов", () => {
    const raw = { smeta_all: { access: true, read: true }, finance: FINANCE_WRITE };
    assert.equal(access.canReturnSmeta(ctx(raw), "d1"), false);
  });

  test("утверждать по-прежнему может только продюсер", () => {
    const raw = { smeta_return: { access: true }, smeta_settings: { access: true }, smeta_all: { access: true, read: true } };
    assert.equal(access.canApproveSmeta(ctx(raw)), false);
    assert.equal(access.canApproveSmeta(ctx({}, PRODUCER)), true);
  });
});

describe("Сметы — настройки", () => {
  test("правка начислений и платежей настроек сметы не даёт", () => {
    assert.equal(
      access.canEditBudgetDictionaries(ctx({ finance: FINANCE_WRITE, smeta_settings: { access: false } })),
      false,
    );
  });

  test("флаг даёт, продюсер может и без флага", () => {
    assert.equal(access.canEditBudgetDictionaries(ctx({ smeta_settings: { access: true } })), true);
    assert.equal(access.canEditBudgetDictionaries(ctx({}, PRODUCER)), true);
  });

  test("роль без раздела (сохранена до миграции) — как раньше, по правке «Финансов»", () => {
    assert.equal(access.canEditBudgetDictionaries(ctx({ finance: FINANCE_WRITE })), true);
    assert.equal(access.canEditBudgetDictionaries(ctx({ finance: { access: true, read: true } })), false);
    assert.equal(
      access.canEditBudgetDictionaries(ctx({ finance: { ...FINANCE_WRITE, access: false } })),
      false,
    );
  });
});
