import Link from "next/link";
import { CallSheetStatusBadge } from "@/features/call-sheets/components/call-sheet-status-badge";
import { AWAITING_APPROVAL_FILTER } from "@/features/call-sheets/lib/awaiting-approval";
import type { CallSheetStatusValue } from "@/features/call-sheets/lib/revision";
import { cn } from "@/shared/lib/cn";
import {
  shootDayStatusLabels,
  shootDayTypeLabels,
} from "@/shared/i18n/domain-labels";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

type DayBrief = {
  id: string;
  dayNumber: number;
  date: Date;
  dayType: keyof typeof shootDayTypeLabels;
  status: keyof typeof shootDayStatusLabels;
  callTime: string | null;
  wrapTime: string | null;
  isNightShift: boolean;
  _count: { scenes: number };
  /** Вызывной дня: статус и версия; null — ещё не создан. */
  callSheet?: { status: CallSheetStatusValue; version: number } | null;
};

export function DayDocsIndex({
  locale,
  projectId,
  days,
  kind,
  awaitingApproval,
}: {
  locale: string;
  projectId: string;
  days: DayBrief[];
  kind: "call-sheets" | "reports";
  /** Только у права «Вызывные — утверждение»: «Ждут утверждения: N» и включён ли фильтр. */
  awaitingApproval?: { count: number; active: boolean };
}) {
  const title =
    kind === "call-sheets" ? "Вызывные листы" : "Производственные отчёты";
  const base =
    kind === "call-sheets"
      ? `/${locale}/projects/${projectId}/call-sheets`
      : `/${locale}/projects/${projectId}/reports`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[27px] font-bold leading-tight">{title}</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            {kind === "call-sheets"
              ? "Только рабочие смены. Выходные, отсыпные и подготовительные дни — в КПП без вызывного."
              : "Формируются из съёмочных дней КПП"}
          </p>
        </div>
        <Link href={`/${locale}/projects/${projectId}/schedule`}>
          <Button variant="secondary">Открыть КПП</Button>
        </Link>
      </div>

      {awaitingApproval ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={awaitingApproval.active ? base : `${base}?filter=${AWAITING_APPROVAL_FILTER}`}
            aria-pressed={awaitingApproval.active}
            className={cn(
              "rounded-lg border px-3 py-1.5 transition-colors",
              awaitingApproval.active
                ? "border-[var(--tone-warning-line)] bg-[var(--tone-warning-bg)] font-medium"
                : "border-[var(--border)] hover:border-[var(--tone-warning-line)]",
            )}
          >
            Ждут утверждения: {awaitingApproval.count}
          </Link>
          {awaitingApproval.active ? (
            <Link href={base} className="text-[var(--muted-fg)] hover:text-[rgb(var(--tint-rgb))]">
              Показать все
            </Link>
          ) : null}
        </div>
      ) : null}

      {days.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          {awaitingApproval?.active
            ? "Вызывных на согласовании нет."
            : "Съёмочных дней пока нет. Создайте их в КПП."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel-solid)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-4 py-3">День</th>
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Тип</th>
                <th className="px-4 py-3">Сцены</th>
                <th className="px-4 py-3">Сбор / конец</th>
                {kind === "call-sheets" ? (
                  <>
                    <th className="px-4 py-3">Статус</th>
                    <th className="px-4 py-3">Версия</th>
                  </>
                ) : null}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.id} className="border-b border-[var(--border)]/60">
                  <td className="px-4 py-3 font-medium">
                    День {day.dayNumber}
                    {day.isNightShift ? " · ночь" : ""}
                  </td>
                  <td className="px-4 py-3">{formatDateShort(day.date)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge>{shootDayTypeLabels[day.dayType]}</Badge>
                      <Badge>{shootDayStatusLabels[day.status]}</Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3">{day._count.scenes}</td>
                  <td className="px-4 py-3 text-[var(--muted-fg)]">
                    {[day.callTime, day.wrapTime].filter(Boolean).join(" – ") ||
                      "—"}
                  </td>
                  {kind === "call-sheets" ? (
                    <>
                      <td className="px-4 py-3">
                        {day.callSheet ? (
                          <CallSheetStatusBadge status={day.callSheet.status} />
                        ) : (
                          <span className="text-[var(--muted-fg)]">не создан</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {day.callSheet ? day.callSheet.version : "—"}
                      </td>
                    </>
                  ) : null}
                  <td className="px-4 py-3 text-right">
                    <Link href={`${base}/${day.id}`}>
                      <Button type="button" variant="secondary">
                        Открыть
                      </Button>
                    </Link>
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
