import assert from "node:assert/strict";
import nodeModule from "node:module";
import { before, describe, test } from "node:test";
import { hasPermission } from "@/features/memberships/permissions";
import {
  buildEmptyMatrix,
  buildFullMatrix,
  canReadAnyEntityFinance,
  type CategoryFinancePermissions,
  type PermissionMatrix,
} from "@/features/roles/permissions-matrix";

// project-nav-groups.ts → role-rules.ts — серверный модуль ("server-only"):
// берём его с условием react-server, как в members-pages-access.test.ts.
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

let nav: typeof import("@/features/projects/lib/project-nav-groups");
before(async () => {
  nav = await import("@/features/projects/lib/project-nav-groups");
});

function hasLedger(
  matrix: PermissionMatrix,
  categoryFinance: Record<string, CategoryFinancePermissions> = {},
) {
  const groups = nav.filterNavGroups(nav.projectNavGroups, {
    can: (p) => hasPermission(matrix, p),
    matrix,
    isProducer: false,
    headDepartmentIds: [],
    anyEntityFinanceRead: canReadAnyEntityFinance(matrix, categoryFinance),
  });
  return groups.some((g) => g.items.some((i) => i.href === "/resource-usage"));
}

/** Как роль «ТЕСТ без финансов»: просмотр сцен, актёров, объектов, ресурсов, отчётов. */
function noFinance(): PermissionMatrix {
  const m = buildEmptyMatrix();
  for (const s of ["scenes", "actors", "characters", "locations", "elements", "reports"] as const) {
    m[s] = { ...m[s], access: true, read: true };
  }
  return m;
}

describe("«Ведомость по использованию» в меню", () => {
  test("без фин. прав пункта нет", () => {
    assert.equal(hasLedger(noFinance()), false);
  });

  test("с фин. просмотром актёров — есть", () => {
    const m = noFinance();
    m.actors = { ...m.actors, financeRead: true };
    assert.equal(hasLedger(m), true);
  });

  test("с фин. просмотром одной категории ресурсов — есть", () => {
    assert.equal(hasLedger(noFinance(), { cat1: { financeRead: true, financeWrite: false } }), true);
  });

  test("продюсер — есть", () => {
    assert.equal(hasLedger(buildFullMatrix()), true);
  });
});
