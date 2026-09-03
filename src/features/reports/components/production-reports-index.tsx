import Link from "next/link";
import {
  shootDayStatusLabels,
  shootDayTypeLabels,
} from "@/shared/i18n/domain-labels";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

type ReportDayRow = {
  id: string;
  dayNumber: number;
  date: Date;
  dayType: keyof typeof shootDayTypeLabels;
  status: keyof typeof shootDayStatusLabels;
  callTime: string | null;
  wrapTime: string | null;
  isNightShift: boolean;
  sceneCount: number;
  factCount: number;
  factDuration: string | null;
};

export function ProductionReportsIndex({
  locale,
  projectId,
  days,
}: {
  locale: string;
  projectId: string;
  days: ReportDayRow[];
}) {
  const base = `/${locale}/projects/${projectId}/reports`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">
            Производственные отчёты
          </h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Факт съёмочного дня: выполнение по сценам, хронометраж и монтажные карточки
          </p>
        </div>
        <Link href={`/${locale}/projects/${projectId}/schedule`}>
          <Button variant="secondary">Открыть КПП</Button>
        </Link>
      </div>

      {days.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Съёмочных дней пока нет. Создайте их в КПП.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-4 py-3">День</th>
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Тип</th>
                <th className="px-4 py-3">Сцены</th>
                <th className="px-4 py-3">План (сбор–конец)</th>
                <th className="px-4 py-3">Факт</th>
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
                  <td className="px-4 py-3">
                    {day.sceneCount}
                    {day.factCount > day.sceneCount ? (
                      <span className="ml-1 text-xs text-[var(--muted-fg)]">
                        (+{day.factCount - day.sceneCount} в отчёте)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-fg)]">
                    {[day.callTime, day.wrapTime].filter(Boolean).join(" – ") ||
                      "—"}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {day.factDuration ?? "—"}
                  </td>
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
