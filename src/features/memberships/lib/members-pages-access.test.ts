import assert from "node:assert/strict";
import nodeModule from "node:module";
import { before, describe, test } from "node:test";
import { hasPermission } from "@/features/memberships/permissions";
import { MEMBERS_PAGES_PERMISSION } from "@/features/memberships/lib/members-pages-access";
import {
  buildEmptyMatrix,
  buildFullMatrix,
  buildViewerMatrix,
  canReadAnyEntityFinance,
  type PermissionMatrix,
} from "@/features/roles/permissions-matrix";

// project-nav-groups.ts → role-rules.ts — серверный модуль ("server-only"):
// берём его с условием react-server, как в permissions-matrix.test.ts.
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
  ["«Участники»: доступ без просмотра", withSection("members", { access: true })],
  ["Только «Настройки проекта»", withSection("project_settings", { access: true, read: true, update: true })],
];

function visibleHrefs(matrix: PermissionMatrix): string[] {
  const groups = nav.filterNavGroups(nav.projectNavGroups, {
    can: (p) => hasPermission(matrix, p),
    matrix,
    isProducer: false,
    headDepartmentIds: [],
    anyEntityFinanceRead: canReadAnyEntityFinance(matrix, {}),
  });
  return nav.navHrefs(groups);
}

describe("«Участники» и «Роли»: пункт меню виден ⇔ страница открывается", () => {
  for (const [name, matrix] of cases) {
    test(name, () => {
      const pageOpens = hasPermission(matrix, MEMBERS_PAGES_PERMISSION);
      const hrefs = visibleHrefs(matrix);
      assert.equal(hrefs.includes("/members"), pageOpens, "пункт «Участники»");
      assert.equal(hrefs.includes("/roles"), pageOpens, "вкладка «Роли и права»");
    });
  }
});
