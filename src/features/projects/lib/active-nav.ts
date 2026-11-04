import type { NavGroup, NavItem } from "@/features/projects/components/project-nav";

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
