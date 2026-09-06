"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/lib/cn";

const TABS = [
  { href: "/smeta", label: "Смета", exact: false },
  { href: "/budget", label: "Статьи", exact: false },
  { href: "/accruals", label: "Начисления", exact: false },
  { href: "/payments", label: "Платежи", exact: false },
  { href: "/finance/reports", label: "Отчёты", exact: false },
  { href: "/finance", label: "Операции", exact: true },
  { href: "/finance/settings", label: "Настройки", exact: false },
  { href: "/counterparties", label: "Контрагенты", exact: false },
] as const;

export function FinanceSectionTabs({
  locale,
  projectId,
}: {
  locale: string;
  projectId: string;
}) {
  const pathname = usePathname();
  const base = `/${locale}/projects/${projectId}`;

  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-1">
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const active = tab.exact
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.href}
            href={href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition",
              active
                ? "bg-white/10 text-[var(--foreground)]"
                : "text-[var(--muted-fg)] hover:bg-white/5 hover:text-[var(--foreground)]",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
