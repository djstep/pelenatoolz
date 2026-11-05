import assert from "node:assert/strict";
import nodeModule from "node:module";
import { before, describe, test } from "node:test";
import type { NavAccess, NavVisibility } from "@/features/projects/lib/project-nav-groups";
import {
  activeNavTabs,
  activeSectionTitle,
  activeTabHref,
  findActiveNavHref,
} from "@/features/projects/lib/active-nav";
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

describe("Словарь сценария в меню проекта", () => {
  test("пункт в «Настройках», адрес тот же, на странице словаря активен он", () => {
    const groups = nav.filterNavGroups(nav.projectNavGroups, access(["script:read"]));
    const settings = groups.find((group) => group.id === "settings")!;
    assert.ok(settings.items.some((item) => item.href === "/screenplay/dictionary"));
    assert.equal(groups.find((group) => group.id === "home")!.items.some((item) => item.label === "Словарь сценария"), false);
    const path = `${BASE}/screenplay/dictionary`;
    assert.equal(findActiveNavHref(groups.flatMap((group) => group.items), BASE, path), "/screenplay/dictionary");
    assert.equal(activeSectionTitle(groups, BASE, path), "Настройки");
  });
});

describe("Операции в меню проекта", () => {
  const groups = () => nav.filterNavGroups(nav.projectNavGroups, access(["finance:read"]));

  test("один пункт и три вкладки, название «Операции»", () => {
    const finance = groups().find((group) => group.id === "finance")!;
    const item = finance.items.find((entry) => entry.label === "Операции")!;
    assert.equal(item.href, "/finance");
    assert.deepEqual(item.tabs?.map((tab) => tab.href), ["/finance", "/accruals", "/payments"]);
    assert.equal(finance.items.some((entry) => entry.href === "/accruals"), false);
    assert.equal(finance.items.some((entry) => entry.href === "/payments"), false);
  });

  test("на вкладках и их карточках активен пункт и видна подпись раздела", () => {
    const items = groups().flatMap((group) => group.items);
    for (const rest of [
      "/finance",
      "/accruals",
      "/payments",
      "/accruals/shift-entry",
      "/payments/payment",
    ]) {
      assert.equal(findActiveNavHref(items, BASE, `${BASE}${rest}`), "/finance", rest);
      assert.equal(activeSectionTitle(groups(), BASE, `${BASE}${rest}`), "Финансы", rest);
    }
  });

  test("отчёты и настройки финансов остаются своими пунктами", () => {
    const items = groups().flatMap((group) => group.items);
    assert.equal(findActiveNavHref(items, BASE, `${BASE}/finance/reports`), "/finance/reports");
    assert.equal(findActiveNavHref(items, BASE, `${BASE}/finance/settings`), "/finance/settings");
  });

  test("полоса только на самих вкладках", () => {
    for (const rest of ["/finance", "/accruals", "/payments"]) {
      assert.equal(activeNavTabs(groups(), BASE, `${BASE}${rest}`)?.length, 3, rest);
    }
    for (const rest of ["/finance/reports", "/accruals/shift-entry", "/payments/payment"]) {
      assert.equal(activeNavTabs(groups(), BASE, `${BASE}${rest}`), null, rest);
    }
  });
});

describe("Контрагенты в меню проекта", () => {
  const groups = (granted: string[]) => nav.filterNavGroups(nav.projectNavGroups, access(granted));
  const item = (granted: string[]) =>
    groups(granted)
      .flatMap((group) => group.items)
      .find((entry) => entry.label === "Контрагенты");

  test("все права: три вкладки, адрес — справочник", () => {
    const entry = item(["finance:read", "contracts:read"])!;
    assert.equal(entry.href, "/counterparties");
    assert.equal(entry.tabsPrefix, "/counterparties");
    assert.deepEqual(entry.tabs?.map((tab) => tab.label), ["Справочник", "Договоры", "Акты"]);
  });

  test("без финансов: договоры и акты, справочника среди вкладок нет", () => {
    const entry = item(["contracts:read"])!;
    assert.equal(entry.href, "/counterparties/contracts");
    assert.deepEqual(entry.tabs?.map((tab) => tab.href), [
      "/counterparties/contracts",
      "/counterparties/acts",
    ]);
    assert.ok(!JSON.stringify(entry).includes("Справочник"));
    // Основа раздела — отдельное поле, это не вкладка: nofin с неё переадресует на договоры.
    const { tabsPrefix, matchPrefixes, ...rest } = entry;
    assert.equal(tabsPrefix, "/counterparties");
    assert.deepEqual(matchPrefixes, ["/counterparties/acts", "/counterparties"]);
    assert.ok(!JSON.stringify(rest).includes('"/counterparties"'));
  });

  test("только финансы: одна вкладка — полосы нет, адрес — справочник", () => {
    const entry = item(["finance:read"])!;
    assert.equal(entry.href, "/counterparties");
    assert.equal(entry.tabs, undefined);
    assert.equal(entry.tabsPrefix, undefined);
    assert.equal(activeNavTabs(groups(["finance:read"]), BASE, `${BASE}/counterparties`), null);
  });

  test("без прав: ни пункта, ни адресов", () => {
    assert.equal(item(["script:read"]), undefined);
    assert.ok(!JSON.stringify(groups(["script:read"])).includes("/counterparties"));
  });

  test("полоса на карточках; выбранная вкладка по адресу", () => {
    const full = groups(["finance:read", "contracts:read"]);
    const tabs = activeNavTabs(full, BASE, `${BASE}/counterparties/person`)!;
    assert.equal(tabs.length, 3);
    const selected = (rest: string) => activeTabHref(tabs, BASE, `${BASE}${rest}`);
    assert.equal(selected("/counterparties"), "/counterparties");
    assert.equal(selected("/counterparties/person"), null);
    assert.equal(selected("/counterparties/contracts"), "/counterparties/contracts");
    assert.equal(selected("/counterparties/contracts/contract"), "/counterparties/contracts");
    assert.equal(selected("/counterparties/acts"), "/counterparties/acts");
  });

  test("граница основы: похожий адрес не считается разделом", () => {
    const full = groups(["finance:read", "contracts:read"]);
    assert.equal(activeNavTabs(full, BASE, `${BASE}/counterparties-other`), null);
  });

  test("у роли без финансов на карточке пункт активен и полоса на месте", () => {
    const limited = groups(["contracts:read"]);
    const path = `${BASE}/counterparties/person`;
    const href = findActiveNavHref(limited.flatMap((group) => group.items), BASE, path);
    assert.equal(href, "/counterparties/contracts");
    assert.equal(activeNavTabs(limited, BASE, path)?.length, 2);
  });
});

describe("Локации в меню проекта", () => {
  const groups = () => nav.filterNavGroups(nav.projectNavGroups, access(["script:read"]));

  test("пункт в «Планировании», вкладки Локации и Скаут; Скаута в «Препродакшне» нет", () => {
    const item = groups()
      .find((group) => group.id === "planning")!
      .items.find((entry) => entry.label === "Локации")!;
    assert.equal(item.href, "/locations");
    assert.deepEqual(item.tabs, [
      { href: "/locations", label: "Локации" },
      { href: "/preproduction/scout", label: "Скаут" },
    ]);
    const defs = nav.projectNavGroups.find((group) => group.id === "preproduction")!;
    assert.ok(!JSON.stringify(defs).includes("/preproduction/scout"));
  });

  test("на вкладках и карточках активны «Локации» и подпись «Планирование»", () => {
    const items = groups().flatMap((group) => group.items);
    for (const rest of [
      "/locations",
      "/preproduction/scout",
      "/locations/location",
      "/preproduction/scout/candidate",
    ]) {
      assert.equal(findActiveNavHref(items, BASE, `${BASE}${rest}`), "/locations", rest);
      assert.equal(activeSectionTitle(groups(), BASE, `${BASE}${rest}`), "Планирование", rest);
    }
    assert.equal(activeNavTabs(groups(), BASE, `${BASE}/preproduction/scout`)?.length, 2);
    assert.equal(activeNavTabs(groups(), BASE, `${BASE}/locations/location`), null);
    assert.equal(activeNavTabs(groups(), BASE, `${BASE}/preproduction/scout/candidate`), null);
  });
});

describe("Персонажи в меню проекта", () => {
  const groups = (granted: string[]) => nav.filterNavGroups(nav.projectNavGroups, access(granted));
  const AVAILABILITY = `${BASE}/schedule/availability`;

  test("один пункт и две вкладки", () => {
    const planning = groups(["cast:read", "schedule:read"]).find((group) => group.id === "planning")!;
    const item = planning.items.find((entry) => entry.label === "Персонажи")!;
    assert.equal(item.href, "/characters");
    assert.deepEqual(item.tabs, [
      { href: "/characters", label: "Персонажи" },
      { href: "/schedule/availability", label: "Занятость" },
    ]);
    assert.equal(planning.items.some((entry) => entry.label === "Занятость"), false);
  });

  test("подсветка на занятости: «Персонажи», а не «КПП» с более коротким адресом", () => {
    const all = groups(["cast:read", "schedule:read"]);
    const items = all.flatMap((group) => group.items);
    assert.equal(findActiveNavHref(items, BASE, AVAILABILITY), "/characters");
    assert.equal(findActiveNavHref(items, BASE, `${BASE}/schedule`), "/schedule");
    assert.equal(activeSectionTitle(all, BASE, AVAILABILITY), "Планирование");
  });

  test("только КПП: пункт ведёт на занятость, полосы нет, подсветка на нём", () => {
    const limited = groups(["schedule:read"]);
    const items = limited.flatMap((group) => group.items);
    const item = items.find((entry) => entry.label === "Персонажи")!;
    assert.equal(item.href, "/schedule/availability");
    assert.equal(item.tabs, undefined);
    assert.ok(!JSON.stringify(limited).includes("/characters"));
    assert.equal(findActiveNavHref(items, BASE, AVAILABILITY), "/schedule/availability");
    assert.equal(activeNavTabs(limited, BASE, AVAILABILITY), null);
  });
});

describe("Съёмочный день в меню проекта", () => {
  const groups = (granted: string[]) => nav.filterNavGroups(nav.projectNavGroups, access(granted));
  const dayItem = (all: ReturnType<typeof groups>) =>
    all.flatMap((group) => group.items).find((entry) => entry.label === "Съёмочный день");

  test("с КПП — две вкладки, сразу за пунктом «Команда», группы «Отчёты» нет", () => {
    const all = groups(["schedule:read", "crew:read"]);
    const planning = all.find((group) => group.id === "planning")!;
    const labels = planning.items.map((item) => item.label);
    assert.equal(labels[labels.indexOf("Съёмочный день") + 1], "Команда");
    assert.equal(all.some((group) => group.id === "reports"), false);
    assert.deepEqual(dayItem(all)!.tabs, [
      { href: "/call-sheets", label: "Вызывные" },
      { href: "/reports", label: "Отчёты смены" },
    ]);
    assert.equal(dayItem(all)!.href, "/call-sheets");
  });

  test("только отчёты: пункт ведёт на них, полосы нет, адреса вызывных нигде нет", () => {
    const all = groups(["report:read"]);
    const item = dayItem(all)!;
    assert.equal(item.href, "/reports");
    assert.equal(item.tabs, undefined);
    assert.ok(!JSON.stringify(all).includes("/call-sheets"));
    assert.ok(!JSON.stringify(all).includes("Вызывные"));
    assert.equal(activeNavTabs(all, BASE, `${BASE}/reports`), null);
    assert.equal(activeNavTabs(all, BASE, `${BASE}/call-sheets`), null);
  });

  test("без прав пункта нет", () => {
    assert.equal(dayItem(groups(["script:read"])), undefined);
  });

  test("доступные адреса — пункты и их вкладки, скрытых нет", () => {
    const full = nav.navHrefs(groups(["schedule:read"]));
    assert.ok(full.includes("/call-sheets"));
    assert.ok(full.includes("/reports"));
    const limited = nav.navHrefs(groups(["report:read"]));
    assert.ok(limited.includes("/reports"));
    assert.ok(!limited.includes("/call-sheets"));
  });

  test("счётчик и на пункте, и на вкладке «Вызывные»; вторая вкладка без него", () => {
    const item = dayItem(nav.withNavCount(groups(["schedule:read"]), "/call-sheets", 3))!;
    assert.equal(item.count, 3);
    assert.deepEqual(item.tabs, [
      { href: "/call-sheets", label: "Вызывные", count: 3 },
      { href: "/reports", label: "Отчёты смены" },
    ]);
  });

  test("вкладка «Вызывные» скрыта: счётчика нет", () => {
    const item = dayItem(nav.withNavCount(groups(["report:read"]), "/call-sheets", 3))!;
    assert.equal(item.count, undefined);
    assert.ok(!JSON.stringify(item).includes("count"));
  });
});

describe("Календарь препродакшена", () => {
  test("место занято: в описании меню после «Кастинга»", () => {
    const { items } = nav.projectNavGroups.find((group) => group.id === "preproduction")!;
    assert.equal(items[0]!.label, "Кастинг");
    assert.equal(items[1]!.label, "Календарь препродакшена");
    assert.equal(items[1]!.soon, undefined);
  });

  test("флаг выключен: пункта нет ни у кого, в браузер адрес не уходит", () => {
    const producer: NavAccess = { ...access([]), can: () => true, isProducer: true };
    const json = JSON.stringify(nav.filterNavGroups(nav.projectNavGroups, producer));
    assert.ok(!json.includes("/preproduction/calendar"));
    assert.ok(!json.includes("Календарь"));
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
