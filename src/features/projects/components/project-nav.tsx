"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/shared/lib/cn";

export type NavItem = {
  href: string;
  label: string;
  soon?: boolean;
};

export type NavGroup = {
  id: string;
  title?: string;
  items: NavItem[];
  emptyHint?: string;
  defaultOpen?: boolean;
};

const STORAGE_KEY = "filmprod-nav-sections";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
      className={cn(
        "h-4 w-4 shrink-0 text-[var(--muted-fg)] transition-transform duration-200",
        open && "rotate-180",
      )}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function NavLink({
  locale,
  projectId,
  item,
  active,
  nested,
}: {
  locale: string;
  projectId: string;
  item: NavItem;
  active: boolean;
  nested?: boolean;
}) {
  const href = `/${locale}/projects/${projectId}${item.href}`;

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between rounded-lg py-2 text-sm transition-all duration-200",
        nested ? "pl-3 pr-2" : "px-3",
        active
          ? "glass-nav-active font-medium text-[var(--foreground)]"
          : "text-[var(--muted-fg)] project-nav-link hover:text-[var(--foreground)]",
        item.soon && !active && "opacity-60",
      )}
    >
      <span className="flex items-center gap-2">
        {nested ? (
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              active ? "bg-[var(--accent)]" : "bg-[var(--muted-fg)]/50",
            )}
          />
        ) : null}
        {item.label}
      </span>
      {item.soon ? (
        <span className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-fg)]">
          скоро
        </span>
      ) : null}
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
  return (
    <div
      className={cn(
        "project-nav-section overflow-hidden rounded-xl transition-colors duration-200",
        open && "project-nav-section--open",
        groupActive && !open && "project-nav-section--active",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors project-nav-link",
          groupActive ? "text-[var(--accent)]" : "text-[var(--foreground)]",
        )}
      >
        <ChevronIcon open={open} />
        <span className="flex-1 text-sm font-medium">{group.title}</span>
        {groupActive ? (
          <span className="rounded-full border border-[color-mix(in srgb,var(--accent)_30%,transparent)] bg-[color-mix(in srgb,var(--accent)_12%,transparent)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent)]">
            здесь
          </span>
        ) : null}
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-[var(--border)] px-1.5 pb-1.5 pt-1">
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

  const activeHref = useMemo(() => {
    const base = `/${locale}/projects/${projectId}`;
    const matches = allItems
      .filter((item) => {
        const full = `${base}${item.href}`;
        if (item.href === "") return pathname === full;
        return pathname === full || pathname.startsWith(`${full}/`);
      })
      .sort((a, b) => b.href.length - a.href.length);
    return matches[0]?.href ?? null;
  }, [allItems, locale, projectId, pathname]);

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
    <nav className="space-y-2">
      {topGroups.map((group) => (
        <div
          key={group.id}
          className="project-nav-section space-y-0.5 rounded-xl p-1.5"
        >
          {group.items.map((item) => (
            <NavLink
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
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    locale={locale}
                    projectId={projectId}
                    item={item}
                    active={isActive(item.href)}
                    nested
                  />
                ))}
              </div>
            ) : group.emptyHint ? (
              <p className="px-3 py-2 text-xs leading-relaxed text-[var(--muted-fg)]">
                {group.emptyHint}
              </p>
            ) : null}
          </CollapsibleSection>
        );
      })}
    </nav>
  );
}
