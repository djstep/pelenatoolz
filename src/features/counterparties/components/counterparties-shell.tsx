"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/lib/cn";

const TABS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "", label: "Справочник", exact: true },
  { href: "/contracts", label: "Договоры" },
  { href: "/acts", label: "Акты" },
];

export function CounterpartiesShell({
  locale,
  projectId,
  children,
}: {
  locale: string;
  projectId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const base = `/${locale}/projects/${projectId}/counterparties`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Контрагенты</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Юрлица, контрагенты, договоры и акты
        </p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-px">
        {TABS.map((tab) => {
          const href = `${base}${tab.href}`;
          const active = tab.exact
            ? pathname === base || pathname === `${base}/`
            : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={tab.href || "root"}
              href={href}
              className={cn(
                "rounded-t-lg px-3 py-2 text-sm font-medium transition",
                active
                  ? "border border-b-transparent border-[var(--border)] bg-[var(--panel-solid)] text-[var(--foreground)]"
                  : "text-[var(--muted-fg)] hover:text-[var(--foreground)]",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
