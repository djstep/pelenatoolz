import type { NavGroup, NavItem, NavTab } from "@/features/projects/components/project-nav";

/**
 * Активный пункт меню проекта: самый длинный подходящий адрес. Обзор и пункты `exact` —
 * только точное совпадение; остальные — адрес, вложенные адреса и `matchPrefixes`.
 */
export function findActiveNavHref(items: NavItem[], base: string, pathname: string): string | null {
  const matches = items
    .filter((item) => {
      const full = `${base}${item.href}`;
      if (item.href === "") return pathname === full;
      if (item.exact) {
        return pathname === full;
      }
      if (pathname === full || pathname.startsWith(`${full}/`)) return true;
      return (item.matchPrefixes ?? []).some((prefix) => {
        const p = `${base}${prefix}`;
        return pathname === p || pathname.startsWith(`${p}/`);
      });
    })
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href ?? null;
}

/** Название раздела меню для текущей страницы; у группы без названия и вне меню — ничего. */
export function activeSectionTitle(groups: NavGroup[], base: string, pathname: string): string | null {
  const href = findActiveNavHref(groups.flatMap((g) => g.items), base, pathname);
  if (href === null) return null;
  return groups.find((g) => g.items.some((item) => item.href === href))?.title ?? null;
}

/**
 * Вкладки раздела, если страница — одна из них. На вложенных адресах (карточках) полосы нет,
 * кроме разделов с `tabsPrefix`: там она видна на всех адресах под основой.
 */
export function activeNavTabs(groups: NavGroup[], base: string, pathname: string): NavTab[] | null {
  for (const group of groups) {
    for (const { tabs, tabsPrefix } of group.items) {
      if (!tabs) continue;
      if (tabs.some((tab) => `${base}${tab.href}` === pathname)) return tabs;
      if (tabsPrefix) {
        const full = `${base}${tabsPrefix}`;
        if (pathname === full || pathname.startsWith(`${full}/`)) return tabs;
      }
    }
  }
  return null;
}

/** Выбранная вкладка: свой адрес, а затем вложенный; на карточке не вкладки — ни одной. */
export function activeTabHref(tabs: NavTab[], base: string, pathname: string): string | null {
  const own = tabs.find((tab) => `${base}${tab.href}` === pathname);
  const parent = tabs.find((tab) => !tab.exact && pathname.startsWith(`${base}${tab.href}/`));
  return (own ?? parent)?.href ?? null;
}
