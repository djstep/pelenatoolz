"use client";

import { useTransition } from "react";
import { exportCashFlowReportAction } from "@/features/finance/actions-reports";
import type { CashFlowReport } from "@/features/finance/queries-reports";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";

type Opt = { id: string; name: string };

function money(n: number, currency: string) {
  return `${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function downloadBase64Xlsx(base64: string, fileName: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function ReportSubTabs({
  locale,
  projectId,
  active,
}: {
  locale: string;
  projectId: string;
  active: "cash-flow";
}) {
  const base = `/${locale}/projects/${projectId}/finance/reports`;
  // План/факт по статьям смет — отдельный экран (волна 2, шаг 5).
  const tabs = [
    {
      id: "cash-flow" as const,
      href: base,
      label: "Движение денег",
    },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm transition",
            active === t.id
              ? "bg-[rgb(var(--tint-rgb)/0.1)] text-[var(--foreground)]"
              : "text-[var(--muted-fg)] hover:bg-[rgb(var(--tint-rgb)/0.05)]",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function CashFlowReportView({
  locale,
  projectId,
  currency,
  report,
  filters,
  companies,
  counterparties,
}: {
  locale: string;
  projectId: string;
  currency: string;
  report: CashFlowReport;
  filters: {
    dateFrom: string;
    dateTo: string;
    companyId: string;
    counterpartyId: string;
  };
  companies: Opt[];
  counterparties: Opt[];
}) {
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <div className="space-y-6">
      <ReportSubTabs locale={locale} projectId={projectId} active="cash-flow" />

      <form
        method="get"
        className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <input type="hidden" name="view" value="cash-flow" />
        <div>
          <Label htmlFor="dateFrom">Период с</Label>
          <Input
            id="dateFrom"
            name="dateFrom"
            type="date"
            defaultValue={filters.dateFrom}
          />
        </div>
        <div>
          <Label htmlFor="dateTo">по</Label>
          <Input
            id="dateTo"
            name="dateTo"
            type="date"
            defaultValue={filters.dateTo}
          />
        </div>
        <div>
          <Label htmlFor="companyId">Компания</Label>
          <Select
            id="companyId"
            name="companyId"
            defaultValue={filters.companyId}
          >
            <option value="">Все</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="counterpartyId">Контрагент</Label>
          <Select
            id="counterpartyId"
            name="counterpartyId"
            defaultValue={filters.counterpartyId}
          >
            <option value="">Все</option>
            {counterparties.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="secondary">
            Применить
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              start(async () => {
                const res = await exportCashFlowReportAction(projectId, {
                  dateFrom: filters.dateFrom || undefined,
                  dateTo: filters.dateTo || undefined,
                  companyId: filters.companyId || undefined,
                  counterpartyId: filters.counterpartyId || undefined,
                });
                if (res.error || !res.base64 || !res.fileName) {
                  toast.error(res.error ?? "Не удалось экспортировать");
                  return;
                }
                downloadBase64Xlsx(res.base64, res.fileName);
                toast.success(res.success ?? "Excel скачан");
              });
            }}
          >
            {pending ? "…" : "Экспорт Excel"}
          </Button>
        </div>
      </form>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            Платежей
          </div>
          <div className="mt-1 text-xl font-semibold">{report.totals.count}</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            Сумма
          </div>
          <div className="mt-1 text-xl font-semibold">
            {money(report.totals.amount, currency)}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            С налогом
          </div>
          <div className="mt-1 text-xl font-semibold">
            {money(report.totals.amountWithTax, currency)}
          </div>
        </div>
      </div>

      {report.rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Нет платежей за выбранный период.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Компания</th>
                <th className="px-4 py-3">Контрагент</th>
                <th className="px-4 py-3">Сумма</th>
                <th className="px-4 py-3">С налогом</th>
                <th className="px-4 py-3">Статьи</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)]/60">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDateShort(r.date)}
                  </td>
                  <td className="px-4 py-3">{r.companyName}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.counterpartyName}</div>
                    {r.comment ? (
                      <div className="text-xs text-[var(--muted-fg)]">
                        {r.comment}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{money(r.amount, currency)}</td>
                  <td className="px-4 py-3">
                    {money(r.amountWithTax, currency)}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted-fg)]">
                    {r.breakdown
                      .map((b) => `${b.title}: ${b.amount.toLocaleString("ru-RU")}`)
                      .join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
