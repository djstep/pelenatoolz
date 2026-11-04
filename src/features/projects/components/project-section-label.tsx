"use client";

import { usePathname } from "next/navigation";
import type { NavGroup } from "@/features/projects/components/project-nav";
import { activeSectionTitle } from "@/features/projects/lib/active-nav";

/** Редактор сметы цеха занимает страницу целиком: своя панель вместо шапки страницы. */
const FULL_PAGE_EDITOR = /\/smeta\/(?!summary$|plan-fact$)[^/]+$/;

/** Шапка страницы: название раздела меню мелко над заголовком (из данных меню, без запросов). */
export function ProjectSectionLabel({ base, groups }: { base: string; groups: NavGroup[] }) {
  const pathname = usePathname();
  if (FULL_PAGE_EDITOR.test(pathname)) return null;
  const title = activeSectionTitle(groups, base, pathname);
  if (!title) return null;
  return <p className="mb-1 shrink-0 text-[13px] text-[var(--muted-fg)]">{title}</p>;
}
