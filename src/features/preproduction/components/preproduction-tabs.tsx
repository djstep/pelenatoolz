"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/lib/cn";

const TABS = [
  { href: "/preproduction/casting", label: "Кастинг" },
  { href: "/preproduction/scout", label: "Скаут" },
] as const;

export function PreproductionTabs({
  locale,
  projectId,
}: {
  locale: string;
  projectId: string;
}) {
  const pathname = usePathname();
  const base = `/${locale}/projects/${projectId}`;

  return (
    <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-1">
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const active =
          pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.href}
            href={href}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              active
                ? "glass-nav-active text-[var(--foreground)]"
                : "text-[var(--muted-fg)] hover:text-[var(--foreground)]",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
