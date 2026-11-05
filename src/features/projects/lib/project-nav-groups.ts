import type { NavGroup, NavItem, NavTab } from "@/features/projects/components/project-nav";
import type { Permission } from "@/features/memberships/permissions";
import {
  canReadAnyEntityFinance,
  type CategoryFinancePermissions,
  type PermissionMatrix,
} from "@/features/roles/permissions-matrix";
import { canOpenProjectSettings } from "@/features/projects/lib/project-list-access";
import { isProducerRole } from "@/features/roles/role-rules";

/**
 * Что знает фильтр меню о пользователе. Права — из того же контекста проекта, что и проверки
 * на страницах (`requireProjectContext` → `parsePermissionMatrix`). Новые условия, которые не
 * являются флагами матрицы (например «глава цеха»), добавляются сюда полями.
 */
export type NavAccess = {
  can: (permission: Permission) => boolean;
  matrix: PermissionMatrix;
  isProducer: boolean;
  /** Цеха, где пользователь — глава (`requireProjectContext` → `headDepartmentIds`). */
  headDepartmentIds: readonly string[];
  /** Фин. просмотр хотя бы одного источника (`canReadAnyEntityFinance`) — для ведомости. */
  anyEntityFinanceRead: boolean;
};

/** Доступ для фильтра меню из контекста проекта (`requireProjectContext`). */
export function navAccessFromContext(ctx: {
  can: NavAccess["can"];
  matrix: PermissionMatrix;
  role: { isSystem: boolean; name: string };
  headDepartmentIds: readonly string[];
  categoryFinance: Record<string, CategoryFinancePermissions>;
}): NavAccess {
  return {
    can: ctx.can,
    matrix: ctx.matrix,
    isProducer: isProducerRole(ctx.role),
    headDepartmentIds: ctx.headDepartmentIds,
    anyEntityFinanceRead: canReadAnyEntityFinance(ctx.matrix, ctx.categoryFinance),
  };
}

/** Условие видимости пункта или группы меню. Нет условия — виден всем участникам проекта. */
export type NavVisibility = (access: NavAccess) => boolean;

type NavTabDef = NavTab & { visible?: NavVisibility };

/** Пункт с вкладками: виден, если видна хотя бы одна; адрес — первая доступная вкладка. */
type NavTabbedItemDef = Omit<NavItem, "href" | "tabs"> & { tabs: NavTabDef[]; visible?: never };

type NavItemDef = (Omit<NavItem, "tabs"> & { visible?: NavVisibility }) | NavTabbedItemDef;

type NavGroupDef = Omit<NavGroup, "items"> & {
  items: NavItemDef[];
  visible?: NavVisibility;
};

/** Виден, если есть любое из прав (раздел, к которому ведут несколько прав). */
function anyOf(...permissions: Permission[]): NavVisibility {
  return (access) => permissions.some((p) => access.can(p));
}

// Условия повторяют проверки на самих страницах: пункт виден ⇔ страница откроется без «Нет доступа».
export const projectNavGroups: NavGroupDef[] = [
  {
    id: "home",
    items: [
      { href: "", label: "Обзор" },
      { href: "/screenplay", label: "Сценарий", visible: anyOf("script:read") },
      {
        href: "/files",
        label: "Файлы",
        visible: anyOf("script:read", "project:read"),
      },
    ],
  },
  {
    id: "preproduction",
    title: "Препродакшн",
    items: [
      {
        label: "Кастинг",
        tabs: [
          { href: "/preproduction/casting", label: "Кандидаты", visible: anyOf("cast:read") },
          { href: "/preproduction/auditions", label: "Пробы", visible: anyOf("cast:read") },
        ],
      },
      { href: "/preproduction/scout", label: "Скаут", visible: anyOf("script:read") },
    ],
  },
  {
    id: "planning",
    title: "Планирование",
    defaultOpen: true,
    items: [
      { href: "/libretto", label: "Сцены (либретто)", visible: anyOf("script:read") },
      { href: "/locations", label: "Локации", visible: anyOf("script:read") },
      { href: "/characters", label: "Персонажи", visible: anyOf("cast:read") },
      { href: "/schedule", label: "КПП", visible: anyOf("schedule:read") },
      {
        href: "/schedule/availability",
        label: "Занятость",
        visible: anyOf("schedule:read", "cast:read"),
      },
      {
        href: "/call-sheets",
        label: "Вызывные",
        visible: anyOf("callsheet:read", "schedule:read"),
      },
      { href: "/crew", label: "Команда", visible: anyOf("crew:read") },
    ],
  },
  {
    id: "reports",
    title: "Отчёты",
    items: [
      {
        href: "/reports",
        label: "Производственные отчёты",
        visible: anyOf("report:read", "schedule:read"),
      },
    ],
  },
  {
    id: "finance",
    title: "Финансы",
    defaultOpen: true,
    items: [
      {
        href: "/smeta",
        label: "Сметы",
        // Как canOpenSmeta (features/smeta/lib/smeta-access.ts).
        visible: (a) =>
          a.isProducer || a.can("smeta:read_all") || a.headDepartmentIds.length > 0,
      },
      { href: "/accruals", label: "Начисления", visible: anyOf("finance:read") },
      {
        href: "/resource-usage",
        label: "Ведомость по использованию",
        // В ведомости только суммы — без фин. просмотра хотя бы одного источника она пустая.
        visible: (a) => a.anyEntityFinanceRead,
      },
      { href: "/payments", label: "Платежи", visible: anyOf("finance:read") },
      { href: "/finance/reports", label: "Отчёты", visible: anyOf("finance:read") },
      {
        href: "/finance",
        label: "Операции",
        exact: true,
        visible: anyOf("finance:read"),
      },
      { href: "/finance/settings", label: "Настройки", visible: anyOf("finance:read") },
      {
        href: "/counterparties",
        label: "Контрагенты",
        visible: anyOf("finance:read", "contracts:read"),
      },
    ],
  },
  {
    id: "post",
    title: "Постпродакшн",
    emptyHint: "Раздел в разработке — модули появятся позже.",
    visible: anyOf("post:read"),
    items: [],
  },
  {
    id: "settings",
    title: "Настройки",
    items: [
      {
        label: "Участники",
        tabs: [
          { href: "/members", label: "Участники", visible: anyOf("members:read") },
          { href: "/roles", label: "Роли и права", visible: anyOf("members:read") },
        ],
      },
      {
        href: "/settings",
        label: "Настройки проекта",
        visible: (a) => canOpenProjectSettings(a.can),
      },
      { href: "/settings/resources", label: "Ресурсы", visible: anyOf("script:read") },
      {
        href: "/settings/call-sheet-template",
        label: "Шаблон вызывного",
        // Как canEditCallSheets (features/call-sheets/lib/template-rules.ts).
        visible: anyOf("callsheet:write", "schedule:write"),
      },
      {
        href: "/settings/departments",
        label: "Цеха",
        // Как canManageDepartments (features/smeta/lib/smeta-access.ts).
        visible: (a) => a.isProducer || a.can("members:manage"),
      },
      {
        href: "/screenplay/dictionary",
        label: "Словарь сценария",
        visible: anyOf("script:read"),
      },
      {
        href: "/audit",
        label: "Журнал изменений",
        visible: anyOf("members:read", "project:read"),
      },
    ],
  },
];

function filterTabbedItem(item: NavTabbedItemDef, access: NavAccess): NavItem | null {
  const { tabs: defs, matchPrefixes = [], ...rest } = item;
  // Только доступные вкладки: адрес скрытой не уходит в браузер ни в каком поле.
  const tabs = defs
    .filter((tab) => !tab.visible || tab.visible(access))
    .map(({ href, label }) => ({ href, label }));
  const [first, ...others] = tabs;
  if (!first) return null;
  const prefixes = [...matchPrefixes, ...others.map((tab) => tab.href)];
  return {
    ...rest,
    href: first.href,
    matchPrefixes: prefixes.length > 0 ? prefixes : undefined,
    tabs: others.length > 0 ? tabs : undefined,
  };
}

function filterNavItem(item: NavItemDef, access: NavAccess): NavItem | null {
  if ("tabs" in item) return filterTabbedItem(item, access);
  if (item.visible && !item.visible(access)) return null;
  const { href, label, soon, matchPrefixes, exact } = item;
  return { href, label, soon, matchPrefixes, exact };
}

/**
 * Меню для конкретного пользователя: скрывает пункты и вкладки без прав и группы, где не
 * осталось пунктов. Условия выполняются на сервере, в браузер уходят только данные пунктов.
 */
export function filterNavGroups(
  groups: NavGroupDef[],
  access: NavAccess,
): NavGroup[] {
  const result: NavGroup[] = [];
  for (const { visible, items, ...group } of groups) {
    if (visible && !visible(access)) continue;
    const shown = items
      .map((item) => filterNavItem(item, access))
      .filter((item) => item !== null);
    if (items.length > 0 && shown.length === 0) continue;
    result.push({ ...group, items: shown });
  }
  return result;
}

/** Адреса, доступные пользователю: пункты меню и их вкладки. */
export function navHrefs(groups: NavGroup[]): string[] {
  return groups.flatMap((group) =>
    group.items.flatMap((item) => [item.href, ...(item.tabs ?? []).map((tab) => tab.href)]),
  );
}

/** Счётчик у пункта меню (`href` — как в `projectNavGroups`); `null` или 0 — без счётчика. */
export function withNavCount(groups: NavGroup[], href: string, count: number | null): NavGroup[] {
  if (!count) return groups;
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => (item.href === href ? { ...item, count } : item)),
  }));
}
