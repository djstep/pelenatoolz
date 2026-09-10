"use client";

import Link from "next/link";
import { OvertimeHistoryTable } from "@/features/payroll/components/overtime-history-table";
import type { UsageStatementRow } from "@/features/payroll/components/overtime-history-table";

export function UsageLedgerDetailView({
  locale,
  projectId,
  title,
  subtitle,
  backHref,
  backLabel,
  cardHref,
  cardLabel,
  rows,
  canEdit,
}: {
  locale: string;
  projectId: string;
  title: string;
  subtitle?: string | null;
  backHref: string;
  backLabel: string;
  cardHref?: string | null;
  cardLabel?: string | null;
  rows: UsageStatementRow[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href={backHref}
          className="text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)]"
        >
          ← {backLabel}
        </Link>
        <h1 className="font-display mt-2 text-2xl font-semibold">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-[var(--muted-fg)]">{subtitle}</p>
        ) : null}
        {cardHref ? (
          <p className="mt-2 text-sm">
            <Link
              href={cardHref}
              className="text-[var(--accent)] hover:underline"
            >
              {cardLabel ?? "Карточка"}
            </Link>
          </p>
        ) : null}
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
        <h2 className="mb-3 font-semibold">Ведомость по использованию</h2>
        <OvertimeHistoryTable
          locale={locale}
          projectId={projectId}
          rows={rows}
          canEdit={canEdit}
          emptyText="Нет смен с фактом работы по этой позиции"
        />
      </section>
    </div>
  );
}
