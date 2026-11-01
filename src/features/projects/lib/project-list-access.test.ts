import assert from "node:assert/strict";
import nodeModule from "node:module";
import { before, describe, test } from "node:test";
import { hasPermission } from "@/features/memberships/permissions";
import {
  projectCardAccess,
  projectIdsForMembersCount,
} from "@/features/projects/lib/project-list-access";
import {
  buildEmptyMatrix,
  buildFullMatrix,
  buildViewerMatrix,
  canReadAnyEntityFinance,
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

function withSection(
  section: keyof PermissionMatrix,
  flags: Partial<PermissionMatrix[keyof PermissionMatrix]>,
): PermissionMatrix {
  const matrix = buildEmptyMatrix();
  matrix[section] = { ...matrix[section], ...flags };
  return matrix;
}

const cases: [string, PermissionMatrix][] = [
  ["Продюсер (всё)", buildFullMatrix()],
  ["Наблюдатель", buildViewerMatrix()],
  ["Без прав", buildEmptyMatrix()],
  ["Только «Участники»: просмотр", withSection("members", { access: true, read: true })],
  ["Только «Настройки проекта»: просмотр", withSection("project_settings", { access: true, read: true })],
  ["Только «Настройки проекта»: правка", withSection("project_settings", { access: true, read: true, update: true })],
  [
    "Только «Настройки проекта»: архивирование",
    withSection("project_settings", { access: true, update: true, delete: true }),
  ],
];

function visibleHrefs(matrix: PermissionMatrix): string[] {
  const groups = nav.filterNavGroups(nav.projectNavGroups, {
    can: (p) => hasPermission(matrix, p),
    matrix,
    isProducer: false,
    headDepartmentIds: [],
    anyEntityFinanceRead: canReadAnyEntityFinance(matrix, {}),
  });
  return groups.flatMap((g) => g.items.map((i) => i.href));
}

describe("список проектов: карточка по тем же правам, что меню проекта", () => {
  for (const [name, matrix] of cases) {
    test(name, () => {
      const access = projectCardAccess(matrix);
      const hrefs = visibleHrefs(matrix);
      assert.equal(access.membersCount, hrefs.includes("/members"), "число участников");
      assert.equal(access.settings, hrefs.includes("/settings"), "«Настройки»");
    });
  }

  test("«Наблюдатель» видит число участников, но не «Настройки»", () => {
    assert.deepEqual(projectCardAccess(buildViewerMatrix()), {
      membersCount: true,
      settings: false,
    });
  });

  test("продюсер видит всё, роль без прав — ничего", () => {
    assert.deepEqual(projectCardAccess(buildFullMatrix()), { membersCount: true, settings: true });
    assert.deepEqual(projectCardAccess(buildEmptyMatrix()), {
      membersCount: false,
      settings: false,
    });
  });

  test("без права «Участники: просмотр» число участников не запрашивается", () => {
    const rows = [
      { id: "p1", access: projectCardAccess(buildFullMatrix()) },
      { id: "p2", access: projectCardAccess(buildEmptyMatrix()) },
      { id: "p3", access: projectCardAccess(buildViewerMatrix()) },
    ];
    assert.deepEqual(projectIdsForMembersCount(rows), ["p1", "p3"]);
    assert.deepEqual(projectIdsForMembersCount([rows[1]!]), []);
  });
});
