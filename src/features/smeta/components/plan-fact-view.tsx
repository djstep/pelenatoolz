"use client";

import { useTransition } from "react";
import { exportPlanFactAction } from "@/features/smeta/export-actions";
import { downloadBase64Xlsx } from "@/features/smeta/lib/download-xlsx";
import { formatRub } from "@/features/smeta/lib/money";
import {
  PLAN_FACT_KIND_LABELS,
  type PlanFactNumbers,
  type PlanFactReport,
} from "@/features/smeta/lib/plan-fact";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

function percent(n: number | null) {
  return n === null ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function Mark({ children, tone }: { children: string; tone: "warning" | "danger" | "muted" }) {
  return (
    <span
      className={cn(
        "ml-2 inline-block rounded-md border px-1.5 py-px text-[11px] whitespace-nowrap",
        tone === "danger" && "border-[var(--danger)]/40 text-[var(--danger)]",
        tone === "warning" && "border-[var(--tone-warning)]/50 text-[var(--tone-warning)]",
        tone === "muted" && "border-[var(--border)] text-[var(--muted-fg)]",
      )}
    >
      {children}
    </span>
  );
}

function NumberCells({ n, bold }: { n: PlanFactNumbers; bold?: boolean }) {
  const over = "text-[var(--danger)]";
  return (
    <>
      <td className={cn("px-3 py-1.5 text-right whitespace-nowrap", bold && "font-semibold")}>
        {formatRub(n.plan)}
      </td>
      <td
        className={cn(
          "px-3 py-1.5 text-right whitespace-nowrap",
          bold && "font-semibold",
          n.overrun && n.accrued > n.plan + 0.005 && over,
        )}
      >
        {formatRub(n.accrued)}
      </td>
      <td
        className={cn(
          "px-3 py-1.5 text-right whitespace-nowrap",
          bold && "font-semibold",
          n.overrun && n.paid > n.plan + 0.005 && over,
        )}
      >
        {formatRub(n.paid)}
      </td>
      <td
        className={cn(
          "px-3 py-1.5 text-right whitespace-nowrap",
          bold && "font-semibold",
          n.overrun && n.remaining < -0.005 && over,
        )}
      >
        {formatRub(n.remaining)}
      </td>
      <td className={cn("px-3 py-1.5 text-right whitespace-nowrap", bold && "font-semibold")}>
        {percent(n.percent)}
      </td>
    </>
  );
}

function TableHead() {
  return (
    <thead className="text-left text-xs text-[var(--muted-fg)]">
      <tr>
        <th className="px-3 py-2 font-medium">Код</th>
        <th className="px-3 py-2 font-medium">Наименование</th>
        <th className="px-3 py-2 text-right font-medium">План</th>
        <th className="px-3 py-2 text-right font-medium">Начислено</th>
        <th className="px-3 py-2 text-right font-medium">Оплачено</th>
        <th className="px-3 py-2 text-right font-medium">Остаток</th>
        <th className="px-3 py-2 text-right font-medium">Исполнение</th>
      </tr>
    </thead>
  );
}

/** План/факт по статьям смет: фильтры в адресе страницы, выгрузка — серверным действием. */
export function PlanFactView({
  projectId,
  report,
  departments,
  filters,
}: {
  projectId: string;
  report: PlanFactReport;
  departments: { id: string; name: string }[];
  filters: { departmentId: string; dateFrom: string; dateTo: string };
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const byPeriod = Boolean(filters.dateFrom || filters.dateTo);

  return (
    <div className="space-y-6">
      <form
        method="get"
        className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4 sm:grid-cols-3"
      >
        <div>
          <Label htmlFor="department">Цех</Label>
          <Select id="department" name="department" defaultValue={filters.departmentId}>
            <option value="">Все цеха</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="dateFrom">Период с</Label>
          <Input id="dateFrom" name="dateFrom" type="date" defaultValue={filters.dateFrom} />
        </div>
        <div>
          <Label htmlFor="dateTo">по</Label>
          <Input id="dateTo" name="dateTo" type="date" defaultValue={filters.dateTo} />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <Button type="submit" variant="secondary">
            Применить
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              start(async () => {
                const res = await exportPlanFactAction(projectId, {
                  departmentId: filters.departmentId || undefined,
                  dateFrom: filters.dateFrom || undefined,
                  dateTo: filters.dateTo || undefined,
                });
                if (res.error !== undefined) {
                  toast.error(res.error);
                  return;
                }
                downloadBase64Xlsx(res.base64, res.fileName);
                toast.success("Excel скачан");
              });
            }}
          >
            {pending ? "…" : "Экспорт Excel"}
          </Button>
        </div>
      </form>

      <p className="text-sm text-[var(--muted-fg)]">
        {byPeriod ? "План — целиком, факт — за период. " : ""}
        Все суммы с налогом. Остаток = план − начислено, исполнение = начислено / план.
      </p>

      {report.departments.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted-fg)]">Цехов нет.</p>
        </Card>
      ) : null}

      {report.departments.map((d) => (
        <Card key={d.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-lg font-semibold">{d.name}</h3>
            <span className="text-xs text-[var(--muted-fg)]">
              {d.versionNumber
                ? `план — версия ${d.versionNumber}`
                : "нет утверждённой версии — план пуст"}
            </span>
          </div>
          {d.rows.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted-fg)]">Ни плана, ни факта.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <TableHead />
                <tbody>
                  {d.rows.map((r) => (
                    <tr
                      key={r.itemId}
                      className={cn(
                        "border-t border-[var(--border)]/60",
                        r.overrun && "bg-[var(--row-danger)]",
                      )}
                    >
                      <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{r.code}</td>
                      <td className="px-3 py-1.5">
                        {r.name}
                        {r.kind !== "plan" ? (
                          <Mark tone="warning">{PLAN_FACT_KIND_LABELS[r.kind]}</Mark>
                        ) : null}
                        {r.removedFromDraft ? <Mark tone="muted">убрана из черновика</Mark> : null}
                        {r.overrun ? <Mark tone="danger">перерасход</Mark> : null}
                      </td>
                      <NumberCells n={r} />
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[var(--border)]">
                    <td />
                    <td className="px-3 py-1.5 font-semibold">
                      Итого по цеху
                      {d.totals.overrun ? <Mark tone="danger">перерасход</Mark> : null}
                    </td>
                    <NumberCells n={d.totals} bold />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}

      {report.unassigned || report.departments.length > 1 ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <TableHead />
              <tbody>
                {report.unassigned ? (
                  <tr className="border-t border-[var(--border)]/60">
                    <td />
                    <td className="px-3 py-1.5">
                      Без статьи
                      <span className="block text-xs text-[var(--muted-fg)]">
                        начисления и строки платежей без кода статьи
                      </span>
                    </td>
                    <NumberCells n={report.unassigned} />
                  </tr>
                ) : null}
                <tr className="border-t-2 border-[var(--border)]">
                  <td />
                  <td className="px-3 py-1.5 font-semibold">
                    Итого по проекту
                    {report.project.overrun ? <Mark tone="danger">перерасход</Mark> : null}
                  </td>
                  <NumberCells n={report.project} bold />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
