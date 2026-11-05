import assert from "node:assert/strict";
import nodeModule from "node:module";
import { before, describe, test } from "node:test";
import type { NavAccess, NavVisibility } from "@/features/projects/lib/project-nav-groups";
import { activeNavTabs, findActiveNavHref } from "@/features/projects/lib/active-nav";
import { buildEmptyMatrix } from "@/features/roles/permissions-matrix";

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

const BASE = "/ru/projects/p1";

function access(granted: string[]): NavAccess {
  return {
    can: (permission) => granted.includes(permission),
    matrix: buildEmptyMatrix(),
    isProducer: false,
    headDepartmentIds: [],
    anyEntityFinanceRead: false,
  };
}

const has =
  (permission: string): NavVisibility =>
  (a) =>
    a.can(permission as never);

/** Вкладки с разными правами: в настоящем Кастинге право одно, скрыть часть вкладок нельзя. */
const groupsWithTabs = [
  {
    id: "section",
    title: "Раздел",
    items: [
      { href: "/plain", label: "Обычный", visible: has("plain") },
      {
        label: "С вкладками",
        tabs: [
          { href: "/tab-a", label: "Первая", visible: has("a") },
          { href: "/tab-b", label: "Вторая", visible: has("b") },
          { href: "/tab-c", label: "Третья", visible: has("c") },
        ],
      },
    ],
  },
];

const filter = (granted: string[]) => nav.filterNavGroups(groupsWithTabs, access(granted));

describe("пункт меню с вкладками", () => {
  test("все вкладки доступны: адрес — первая, остальные считаются его страницами", () => {
    const [item] = filter(["a", "b", "c"])[0]!.items;
    assert.equal(item!.href, "/tab-a");
    assert.deepEqual(item!.matchPrefixes, ["/tab-b", "/tab-c"]);
    assert.deepEqual(item!.tabs, [
      { href: "/tab-a", label: "Первая" },
      { href: "/tab-b", label: "Вторая" },
      { href: "/tab-c", label: "Третья" },
    ]);
  });

  test("первая скрыта: пункт ведёт на первую доступную", () => {
    const [item] = filter(["b", "c"])[0]!.items;
    assert.equal(item!.href, "/tab-b");
    assert.deepEqual(item!.tabs?.map((tab) => tab.href), ["/tab-b", "/tab-c"]);
  });

  test("доступна одна вкладка: пункт ведёт на неё, полосы нет", () => {
    const [item] = filter(["c"])[0]!.items;
    assert.equal(item!.href, "/tab-c");
    assert.equal(item!.tabs, undefined);
    assert.equal(item!.matchPrefixes, undefined);
  });

  test("ни одной вкладки: пункта нет, а без других пунктов нет и группы", () => {
    assert.deepEqual(filter(["plain"])[0]!.items.map((item) => item.href), ["/plain"]);
    assert.deepEqual(filter([]), []);
  });

  test("адрес скрытой вкладки не уходит в браузер ни в каком поле", () => {
    const json = JSON.stringify(filter(["a", "c"]));
    assert.ok(!json.includes("/tab-b"));
    assert.ok(!json.includes("Вторая"));
    assert.equal(activeNavTabs(filter(["a", "c"]), BASE, `${BASE}/tab-b`), null);
  });

  test("в результате нет функций: условия не попадают в клиентские компоненты", () => {
    const walk = (value: unknown): void => {
      assert.notEqual(typeof value, "function");
      if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(filter(["a", "b", "c", "plain"]));
    walk(nav.filterNavGroups(nav.projectNavGroups, access(["cast:read"])));
  });

  test("у обычного пункта вкладок нет, условие снято", () => {
    const item = filter(["plain"])[0]!.items[0]!;
    assert.equal(item.tabs, undefined);
    assert.equal("visible" in item, false);
  });
});

describe("Кастинг в меню проекта", () => {
  const allItems = (granted: string[]) =>
    nav.filterNavGroups(nav.projectNavGroups, access(granted)).flatMap((group) => group.items);

  test("с правом — один пункт и две вкладки на прежних адресах", () => {
    const items = allItems(["cast:read"]).filter((item) => item.label.startsWith("Кастинг"));
    assert.equal(items.length, 1);
    assert.equal(items[0]!.label, "Кастинг");
    assert.equal(items[0]!.href, "/preproduction/casting");
    assert.deepEqual(items[0]!.tabs, [
      { href: "/preproduction/casting", label: "Кандидаты" },
      { href: "/preproduction/auditions", label: "Пробы" },
    ]);
  });

  test("без права — ни пункта, ни адресов", () => {
    const json = JSON.stringify(allItems(["script:read"]));
    assert.ok(!json.includes("/preproduction/casting"));
    assert.ok(!json.includes("/preproduction/auditions"));
  });

  test("на вкладках и карточках активен «Кастинг», полоса — только на вкладках", () => {
    const groups = nav.filterNavGroups(nav.projectNavGroups, access(["cast:read"]));
    const items = groups.flatMap((group) => group.items);
    for (const rest of [
      "/preproduction/casting",
      "/preproduction/auditions",
      "/preproduction/casting/person",
      "/preproduction/auditions/audition",
    ]) {
      assert.equal(findActiveNavHref(items, BASE, `${BASE}${rest}`), "/preproduction/casting", rest);
    }
    assert.equal(activeNavTabs(groups, BASE, `${BASE}/preproduction/auditions`)?.length, 2);
    assert.equal(activeNavTabs(groups, BASE, `${BASE}/preproduction/casting/person`), null);
    assert.equal(activeNavTabs(groups, BASE, `${BASE}/preproduction/scout`), null);
  });
});
