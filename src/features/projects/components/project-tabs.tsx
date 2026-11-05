"use client";

import { usePathname } from "next/navigation";
import type { NavGroup } from "@/features/projects/components/project-nav";
import { activeNavTabs } from "@/features/projects/lib/active-nav";
import { SegmentLinks } from "@/shared/ui/segment-control";

/** Полоса вкладок раздела над страницей (из данных меню, без запросов). */
export function ProjectTabs({ base, groups }: { base: string; groups: NavGroup[] }) {
  const pathname = usePathname();
  const tabs = activeNavTabs(groups, base, pathname);
  if (!tabs) return null;
  return (
    <SegmentLinks
      label="Вкладки раздела"
      className="mb-4 shrink-0"
      activeHref={pathname}
      items={tabs.map((tab) => ({ href: `${base}${tab.href}`, label: tab.label }))}
    />
  );
}
