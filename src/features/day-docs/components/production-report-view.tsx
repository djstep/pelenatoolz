import Link from "next/link";
import {
  buildCastForDay,
  buildDayStats,
  formatSceneLine,
  formatSceneNumber,
  sceneStatusLabel,
  type DayDocBundle,
} from "@/features/day-docs/lib/build-day-doc";
import { PrintButton } from "@/features/day-docs/components/print-button";
import { formatPagesMinutes } from "@/features/schedule/lib/day-summary";
import {
  shootDayStatusLabels,
  shootDayTypeLabels,
} from "@/shared/i18n/domain-labels";
import { Badge } from "@/shared/ui/badge";

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function ProductionReportView({
  locale,
  projectId,
  bundle,
}: {
  locale: string;
  projectId: string;
  bundle: DayDocBundle;
}) {
  const { project, day } = bundle;
  const stats = buildDayStats(day);
  const cast = buildCastForDay(bundle);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm text-[var(--muted-fg)]">
            <Link
              href={`/${locale}/projects/${projectId}/reports`}
              className="hover:text-white"
            >
              ← Все отчёты
            </Link>
            {" · "}
            <Link
              href={`/${locale}/projects/${projectId}/schedule`}
              className="hover:text-white"
            >
              КПП
            </Link>
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold">
            Производственный отчёт · День {day.dayNumber}
          </h2>
        </div>
        <PrintButton />
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
        <h1 className="font-display text-xl font-semibold">
          {project.fullName || project.name}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          {formatDate(day.date)}
          {project.city ? ` · ${project.city}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{shootDayTypeLabels[day.dayType]}</Badge>
          <Badge>{shootDayStatusLabels[day.status]}</Badge>
          {day.isNightShift ? <Badge>Ночная смена</Badge> : null}
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Сцен в плане" value={String(stats.sceneCount)} />
          <Stat label="Снято" value={String(stats.shotCount)} />
          <Stat label="Не снято" value={String(stats.notShotCount)} />
          <Stat label="Хронометраж" value={stats.timingLabel} />
          <Stat label="Объём" value={stats.pagesLabel} />
          <Stat label="Сбор" value={day.callTime || "—"} />
          <Stat label="Конец" value={day.wrapTime || "—"} />
          <Stat label="Актёров / ролей" value={String(cast.length)} />
        </dl>

        {day.notes || day.comment ? (
          <p className="mt-4 rounded-xl border border-[var(--border)] bg-black/20 p-3 text-sm text-[var(--muted-fg)]">
            {[day.notes, day.comment].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
        <h3 className="mb-3 font-semibold">Выполнение по сценам</h3>
        {day.scenes.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">Сцен нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                  <th className="py-2 pr-3">№</th>
                  <th className="py-2 pr-3">Сцена</th>
                  <th className="py-2 pr-3">План</th>
                  <th className="py-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {day.scenes.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border)]/60">
                    <td className="py-2 pr-3 font-medium">
                      {formatSceneNumber(row.scene)}
                    </td>
                    <td className="py-2 pr-3">{formatSceneLine(row.scene)}</td>
                    <td className="py-2 pr-3">
                      {formatPagesMinutes(
                        row.estimatedPages ?? row.scene.pageCount,
                        row.scene.planSeconds,
                      )}
                    </td>
                    <td className="py-2">
                      {sceneStatusLabel(row.scene.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
        <h3 className="mb-3 font-semibold">Объекты дня</h3>
        {stats.locations.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">Объекты не указаны.</p>
        ) : (
          <ul className="list-inside list-disc text-sm">
            {stats.locations.map((loc) => (
              <li key={loc}>{loc}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-black/20 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted-fg)]">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}
