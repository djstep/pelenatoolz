import Link from "next/link";
import {
  buildCastForDay,
  type DayDocBundle,
} from "@/features/day-docs/lib/build-day-doc";
import { PrintButton } from "@/features/day-docs/components/print-button";
import { actorRoleTypeLabels } from "@/shared/i18n/domain-labels";

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function ActorEmploymentView({
  locale,
  projectId,
  bundle,
}: {
  locale: string;
  projectId: string;
  bundle: DayDocBundle;
}) {
  const { project, day } = bundle;
  const cast = buildCastForDay(bundle);
  const withActor = cast.filter((c) => c.actorId);
  const withoutActor = cast.filter((c) => !c.actorId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm text-[var(--muted-fg)]">
            <Link
              href={`/${locale}/projects/${projectId}/schedule`}
              className="hover:text-white"
            >
              ← КПП
            </Link>
            {" · "}
            <Link
              href={`/${locale}/projects/${projectId}/actors`}
              className="hover:text-white"
            >
              Актёры
            </Link>
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold">
            Занятость актёров · День {day.dayNumber}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            {project.name} · {formatDate(day.date)}
          </p>
        </div>
        <PrintButton />
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          <span>
            Ролей в дне: <strong>{cast.length}</strong>
          </span>
          <span>
            С актёром: <strong>{withActor.length}</strong>
          </span>
          <span>
            Без актёра: <strong>{withoutActor.length}</strong>
          </span>
        </div>

        {cast.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">
            В сценах дня нет персонажей.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                  <th className="py-2 pr-3">Актёр</th>
                  <th className="py-2 pr-3">Персонаж</th>
                  <th className="py-2 pr-3">Тип роли</th>
                  <th className="py-2 pr-3">Сцены</th>
                  <th className="py-2 pr-3">Подача</th>
                  <th className="py-2">Контакт</th>
                </tr>
              </thead>
              <tbody>
                {cast.map((row) => (
                  <tr
                    key={`${row.characterName}-${row.actorId ?? "na"}`}
                    className="border-b border-[var(--border)]/60"
                  >
                    <td className="py-2 pr-3 font-medium">
                      {row.actorName || (
                        <span className="text-amber-300">не назначен</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{row.characterName}</td>
                    <td className="py-2 pr-3 text-[var(--muted-fg)]">
                      {row.roleType
                        ? actorRoleTypeLabels[
                            row.roleType as keyof typeof actorRoleTypeLabels
                          ]
                        : "—"}
                    </td>
                    <td className="py-2 pr-3">{row.sceneNumbers.join(", ")}</td>
                    <td className="py-2 pr-3">
                      {[row.pickup, row.arrival].filter(Boolean).join(" / ") ||
                        "—"}
                    </td>
                    <td className="py-2 text-[var(--muted-fg)]">
                      {[row.phone, row.email].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
