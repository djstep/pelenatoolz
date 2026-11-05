"use client";

import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Film,
  Folder,
  LayoutGrid,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { findActiveNavHref } from "@/features/projects/lib/active-nav";
import { cn } from "@/shared/lib/cn";

/** Вкладка раздела: своя страница со своим адресом. */
export type NavTab = {
  href: string;
  label: string;
  /** Выбрана только на своём адресе, а не на вложенных (нужно при `tabsPrefix`). */
  exact?: boolean;
};

export type NavItem = {
  href: string;
  label: string;
  soon?: boolean;
  /** Extra path prefixes that count as active for this item (e.g. finance sub-tabs). */
  matchPrefixes?: string[];
  /** If true, only exact path match (not nested routes). */
  exact?: boolean;
  /** Счётчик справа (например, вызывные на согласовании); нет — не показывается. */
  count?: number;
  /** Вкладки раздела над страницей: только доступные пользователю и только если их больше одной. */
  tabs?: NavTab[];
  /** Основа раздела: полоса видна на всех адресах под ней, в том числе на карточках. */
  tabsPrefix?: string;
};

export type NavGroup = {
  id: string;
  title?: string;
  items: NavItem[];
  emptyHint?: string;
  defaultOpen?: boolean;
};

const STORAGE_KEY = "filmprod-nav-sections";

/** Иконки разделов (уровень 1) — по id группы. */
const GROUP_ICONS: Record<string, LucideIcon> = {
  preproduction: Users,
  planning: CalendarDays,
  reports: ClipboardList,
  finance: Wallet,
  post: Film,
  settings: Settings,
};

/** Пункты группы без названия оформлены как разделы — у каждого своя иконка (по адресу). */
const TOP_ITEM_ICONS: Record<string, LucideIcon> = {
  "": LayoutGrid,
  "/screenplay": FileText,
  "/files": Folder,
};

function NavCount({ count }: { count: number }) {
  return (
    <span
      className="min-w-[1.25rem] rounded-full bg-[var(--sidebar-warn-bg)] px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-[var(--sidebar-warn-fg)] tabular-nums"
      title="На согласовании"
      aria-label={`на согласовании: ${count}`}
    >
      {count}
    </span>
  );
}

function SoonPill() {
  return (
    <span className="rounded-[5px] border border-[var(--sidebar-line)] px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-[var(--sidebar-muted)]">
      скоро
    </span>
  );
}

/** Раздел без подразделов (Обзор, Сценарий, Файлы): иконка + название, 36 px. */
function TopLink({
  locale,
  projectId,
  item,
  active,
}: {
  locale: string;
  projectId: string;
  item: NavItem;
  active: boolean;
}) {
  const href = `/${locale}/projects/${projectId}${item.href}`;
  const Icon = TOP_ITEM_ICONS[item.href] ?? LayoutGrid;

  return (
    <Link
      href={href}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-[650] transition-colors",
        active
          ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active-fg)]"
          : "text-[var(--sidebar-fg)] hover:bg-[var(--sidebar-hover)]",
        item.soon && !active && "opacity-60",
      )}
    >
      <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.count ? <NavCount count={item.count} /> : null}
      {item.soon ? <SoonPill /> : null}
    </Link>
  );
}

/** Подраздел (уровень 2): отступ, направляющая слева, 30 px; активный — плашка и метка. */
function SubLink({
  locale,
  projectId,
  item,
  active,
}: {
  locale: string;
  projectId: string;
  item: NavItem;
  active: boolean;
}) {
  const href = `/${locale}/projects/${projectId}${item.href}`;

  return (
    <Link
      href={href}
      className={cn(
        "relative flex h-[30px] items-center justify-between gap-2 rounded-md px-2.5 text-[13.5px] transition-colors",
        active
          ? "bg-[var(--sidebar-active-bg)] font-semibold text-[var(--sidebar-active-fg)] before:absolute before:-left-[11px] before:top-1/2 before:h-4 before:w-[2px] before:-translate-y-1/2 before:rounded-full before:bg-[var(--sidebar-fg)]"
          : "font-[450] text-[var(--sidebar-fg-2)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-fg)]",
        item.soon && !active && "opacity-60",
      )}
    >
      <span className="min-w-0 truncate">{item.label}</span>
      {item.count ? <NavCount count={item.count} /> : null}
      {item.soon ? <SoonPill /> : null}
    </Link>
  );
}

function CollapsibleSection({
  group,
  open,
  onToggle,
  groupActive,
  children,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  groupActive: boolean;
  children: React.ReactNode;
}) {
  const Icon = GROUP_ICONS[group.id] ?? Folder;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="border-t border-[var(--sidebar-line)] py-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-[650] text-[var(--sidebar-fg)] transition-colors hover:bg-[var(--sidebar-hover)]"
      >
        <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.75} aria-hidden />
        <span className={cn("min-w-0 flex-1 truncate", groupActive && !open && "text-white")}>
          {group.title}
        </span>
        {/* Здесь активная страница: у свёрнутого раздела — точка; для чтения с экрана — «здесь», как раньше. */}
        {groupActive ? (
          <>
            {!open ? (
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sidebar-fg)]" />
            ) : null}
            <span className="sr-only">здесь</span>
          </>
        ) : null}
        <Chevron className="h-4 w-4 shrink-0 text-[var(--sidebar-muted)]" aria-hidden />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="ml-[18px] mt-0.5 border-l-[1.5px] border-[var(--sidebar-guide)] pb-1 pl-2.5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectNav({
  locale,
  projectId,
  groups,
}: {
  locale: string;
  projectId: string;
  groups: NavGroup[];
}) {
  const pathname = usePathname();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);

  const allItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  const activeHref = useMemo(
    () => findActiveNavHref(allItems, `/${locale}/projects/${projectId}`, pathname),
    [allItems, locale, projectId, pathname],
  );

  const isActive = useCallback(
    (href: string) => activeHref === href,
    [activeHref],
  );

  const collapsibleGroups = useMemo(
    () => groups.filter((g) => g.title),
    [groups],
  );

  const topGroups = useMemo(() => groups.filter((g) => !g.title), [groups]);

  useEffect(() => {
    let stored: Record<string, boolean> = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as Record<string, boolean>;
    } catch {
      /* ignore */
    }

    const next: Record<string, boolean> = {};
    for (const group of collapsibleGroups) {
      const active = group.items.some((item) => isActive(item.href));
      next[group.id] =
        active || (stored[group.id] ?? group.defaultOpen ?? false);
    }

    setOpenSections(next);
    setReady(true);
  }, [collapsibleGroups, isActive]);

  useEffect(() => {
    if (!ready) return;
    for (const group of collapsibleGroups) {
      if (group.items.some((item) => isActive(item.href))) {
        setOpenSections((prev) =>
          prev[group.id] ? prev : { ...prev, [group.id]: true },
        );
      }
    }
  }, [pathname, ready, collapsibleGroups, isActive]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(openSections));
  }, [openSections, ready]);

  function toggleSection(id: string) {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <nav>
      {topGroups.map((group) => (
        <div key={group.id} className="space-y-0.5 pb-1.5">
          {group.items.map((item) => (
            <TopLink
              key={item.href || "__overview"}
              locale={locale}
              projectId={projectId}
              item={item}
              active={isActive(item.href)}
            />
          ))}
        </div>
      ))}

      {collapsibleGroups.map((group) => {
        const groupActive = group.items.some((item) => isActive(item.href));
        const open = openSections[group.id] ?? false;

        return (
          <CollapsibleSection
            key={group.id}
            group={group}
            open={open}
            onToggle={() => toggleSection(group.id)}
            groupActive={groupActive}
          >
            {group.items.length > 0 ? (
              <div className="space-y-0.5 pt-0.5">
                {group.items.map((item) => (
                  <SubLink
                    key={item.href}
                    locale={locale}
                    projectId={projectId}
                    item={item}
                    active={isActive(item.href)}
                  />
                ))}
              </div>
            ) : group.emptyHint ? (
              <p className="px-2.5 py-1.5 text-xs leading-relaxed text-[var(--sidebar-muted)]">
                {group.emptyHint}
              </p>
            ) : null}
          </CollapsibleSection>
        );
      })}
    </nav>
  );
}
