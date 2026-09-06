"use client";

import { useTransition } from "react";
import {
  exportCashFlowReportAction,
  exportPlanFactReportAction,
} from "@/features/finance/actions-reports";
import type {
  CashFlowReport,
  PlanFactReport,
} from "@/features/finance/queries-reports";
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
  active: "plan-fact" | "cash-flow";
}) {
  const base = `/${locale}/projects/${projectId}/finance/reports`;
  const tabs = [
    { id: "plan-fact" as const, href: base, label: "План-факт по статьям" },
    {
      id: "cash-flow" as const,
      href: `${base}?view=cash-flow`,
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
              ? "bg-white/10 text-[var(--foreground)]"
              : "text-[var(--muted-fg)] hover:bg-white/5",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function PlanFactReportView({
  locale,
  projectId,
  currency,
  report,
  filters,
}: {
  locale: string;
  projectId: string;
  currency: string;
  report: PlanFactReport;
  filters: { dateFrom: string; dateTo: string };
}) {
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <div className="space-y-6">
      <ReportSubTabs locale={locale} projectId={projectId} active="plan-fact" />

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4"
      >
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
        <input type="hidden" name="view" value="plan-fact" />
        <Button type="submit" variant="secondary">
          Применить
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            start(async () => {
              const res = await exportPlanFactReportAction(projectId, {
                dateFrom: filters.dateFrom || undefined,
                dateTo: filters.dateTo || undefined,
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
      </form>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(
          [
            ["План", report.totals.planned],
            ["Начисления", report.totals.accrued],
            ["Оплачено", report.totals.paid],
            ["План − начисл.", report.totals.variancePlan],
            ["Не оплачено", report.totals.unpaid],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4"
          >
            <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
              {label}
            </div>
            <div
              className={cn(
                "mt-1 text-lg font-semibold",
                label === "Не оплачено" && value > 0
                  ? "text-amber-300/90"
                  : undefined,
              )}
            >
              {money(value, currency)}
            </div>
          </div>
        ))}
      </div>

      {report.rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Статей сметы пока нет.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-4 py-3">Категория</th>
                <th className="px-4 py-3">Статья</th>
                <th className="px-4 py-3">План</th>
                <th className="px-4 py-3">Начисления</th>
                <th className="px-4 py-3">Оплачено</th>
                <th className="px-4 py-3">План − начисл.</th>
                <th className="px-4 py-3">Не оплачено</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.budgetLineId} className="border-b border-[var(--border)]/60">
                  <td className="px-4 py-3 text-[var(--muted-fg)]">
                    {r.categoryLabel}
                  </td>
                  <td className="px-4 py-3 font-medium">{r.title}</td>
                  <td className="px-4 py-3">{money(r.planned, currency)}</td>
                  <td className="px-4 py-3">{money(r.accrued, currency)}</td>
                  <td className="px-4 py-3">{money(r.paid, currency)}</td>
                  <td
                    className={cn(
                      "px-4 py-3",
                      r.variancePlan < 0 ? "text-red-300" : undefined,
                    )}
                  >
                    {money(r.variancePlan, currency)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3",
                      r.unpaid > 0 ? "text-amber-300/90" : undefined,
                    )}
                  >
                    {money(r.unpaid, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--border)] font-semibold">
                <td className="px-4 py-3" colSpan={2}>
                  Итого
                </td>
                <td className="px-4 py-3">
                  {money(report.totals.planned, currency)}
                </td>
                <td className="px-4 py-3">
                  {money(report.totals.accrued, currency)}
                </td>
                <td className="px-4 py-3">
                  {money(report.totals.paid, currency)}
                </td>
                <td className="px-4 py-3">
                  {money(report.totals.variancePlan, currency)}
                </td>
                <td className="px-4 py-3">
                  {money(report.totals.unpaid, currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
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
