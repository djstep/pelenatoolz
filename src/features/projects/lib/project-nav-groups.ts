import type { NavGroup, NavItem } from "@/features/projects/components/project-nav";
import type { Permission } from "@/features/memberships/permissions";
import type { PermissionMatrix } from "@/features/roles/permissions-matrix";
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
};

/** Доступ для фильтра меню из контекста проекта (`requireProjectContext`). */
export function navAccessFromContext(ctx: {
  can: NavAccess["can"];
  matrix: PermissionMatrix;
  role: { isSystem: boolean; name: string };
  headDepartmentIds: readonly string[];
}): NavAccess {
  return {
    can: ctx.can,
    matrix: ctx.matrix,
    isProducer: isProducerRole(ctx.role),
    headDepartmentIds: ctx.headDepartmentIds,
  };
}

/** Условие видимости пункта или группы меню. Нет условия — виден всем участникам проекта. */
export type NavVisibility = (access: NavAccess) => boolean;

type NavItemDef = NavItem & { visible?: NavVisibility };

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
      { href: "/preproduction/casting", label: "Кастинг", visible: anyOf("cast:read") },
      {
        href: "/preproduction/auditions",
        label: "Кастинг-пробы",
        visible: anyOf("cast:read"),
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
      { href: "/budget", label: "Статьи", visible: anyOf("budget:read") },
      { href: "/accruals", label: "Начисления", visible: anyOf("finance:read") },
      {
        href: "/resource-usage",
        label: "Ведомость по использованию",
        visible: anyOf("finance:read", "script:read"),
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
      { href: "/members", label: "Участники", visible: anyOf("members:read") },
      { href: "/roles", label: "Роли и права", visible: anyOf("members:read") },
      {
        href: "/settings",
        label: "Настройки проекта",
        visible: anyOf("project:write", "project:archive"),
      },
      { href: "/settings/resources", label: "Ресурсы", visible: anyOf("script:read") },
      {
        href: "/settings/departments",
        label: "Цеха",
        // Как canManageDepartments (features/smeta/lib/smeta-access.ts).
        visible: (a) => a.isProducer || a.can("members:manage"),
      },
      {
        href: "/audit",
        label: "Журнал изменений",
        visible: anyOf("members:read", "project:read"),
      },
    ],
  },
];

/**
 * Меню для конкретного пользователя: скрывает пункты без прав и группы, где не осталось
 * пунктов. Условия выполняются на сервере, в браузер уходят только данные пунктов.
 */
export function filterNavGroups(
  groups: NavGroupDef[],
  access: NavAccess,
): NavGroup[] {
  const result: NavGroup[] = [];
  for (const { visible, items, ...group } of groups) {
    if (visible && !visible(access)) continue;
    const shown = items
      .filter((item) => !item.visible || item.visible(access))
      .map(({ href, label, soon, matchPrefixes, exact }) => ({
        href,
        label,
        soon,
        matchPrefixes,
        exact,
      }));
    if (items.length > 0 && shown.length === 0) continue;
    result.push({ ...group, items: shown });
  }
  return result;
}
