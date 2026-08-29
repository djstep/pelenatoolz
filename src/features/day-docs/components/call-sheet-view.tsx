import Link from "next/link";
import { CallSheetEditor } from "@/features/day-docs/components/call-sheet-edit";
import { PrintButton } from "@/features/day-docs/components/print-button";
import {
  buildCastForDay,
  buildDayStats,
  buildResourceTables,
  buildShootingSlotDetails,
  formatSceneLine,
  inferDayNightLabel,
  sceneStatusLabel,
  slotDurationLabel,
  type DayDocBundle,
  type ResourceTableRow,
} from "@/features/day-docs/lib/build-day-doc";
import type { DayAstro } from "@/features/day-docs/lib/city-astro";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import { formatPagesMinutes } from "@/features/schedule/lib/day-summary";
import {
  actorRoleTypeLabels,
  dayNightLabels,
  sceneStatusColors,
  shootDayStatusLabels,
  shootDayTypeLabels,
} from "@/shared/i18n/domain-labels";
import { Badge } from "@/shared/ui/badge";
import type { getNextShootDayBrief } from "@/features/day-docs/queries";

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatShortDate(date: Date) {
  return new Date(date).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

function DocSection({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`call-sheet-section rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5 ${className}`}
    >
      <h3 className="mb-3 font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function MetaGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="flex justify-between gap-4 text-sm sm:block">
          <dt className="text-[var(--muted-fg)]">{item.label}</dt>
          <dd className="font-medium sm:mt-0.5">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TimingPair({ ready, wrap }: { ready: string | null; wrap: string | null }) {
  if (!ready && !wrap) return <>—</>;
  return (
    <span className="whitespace-nowrap">
      {ready || "—"}
      {wrap ? ` / ${wrap}` : ""}
    </span>
  );
}

function ResourceTable({
  rows,
  showMakeup = true,
  showCostume = true,
}: {
  rows: ResourceTableRow[];
  showMakeup?: boolean;
  showCostume?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted-fg)]">Нет данных на этот день.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
            <th className="py-2 pr-3">Наименование</th>
            <th className="py-2 pr-3">Сцены</th>
            <th className="py-2 pr-3">Прибытие</th>
            {showCostume ? <th className="py-2 pr-3">Костюм</th> : null}
            {showMakeup ? <th className="py-2 pr-3">Грим</th> : null}
            <th className="py-2 pr-3">Готовность</th>
            <th className="py-2">Конец</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-[var(--border)]/60">
              <td className="py-2 pr-3 font-medium">{row.name}</td>
              <td className="py-2 pr-3 text-[var(--muted-fg)]">
                {row.sceneNumbers.join(", ")}
              </td>
              <td className="py-2 pr-3">{row.arrival || "—"}</td>
              {showCostume ? (
                <td className="py-2 pr-3">{row.costume || "—"}</td>
              ) : null}
              {showMakeup ? <td className="py-2 pr-3">{row.makeup || "—"}</td> : null}
              <td className="py-2 pr-3">{row.ready || "—"}</td>
              <td className="py-2">{row.wrap || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TagList({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <p className="text-xs text-[var(--muted-fg)]">
      <span className="text-foreground/80">{label}:</span> {items.join(", ")}
    </p>
  );
}

export function CallSheetView({
  locale,
  projectId,
  bundle,
  astro,
  nextDay,
  nextDayAstro,
  canEdit,
}: {
  locale: string;
  projectId: string;
  bundle: DayDocBundle;
  astro: DayAstro | null;
  nextDay: Awaited<ReturnType<typeof getNextShootDayBrief>>;
  nextDayAstro: DayAstro | null;
  canEdit: boolean;
}) {
  const { project, day } = bundle;
  const stats = buildDayStats(day);
  const cast = buildCastForDay(bundle);
  const resources = buildResourceTables(bundle);
  const dayNight = inferDayNightLabel(day);

  const weatherParts = [
    astro?.weatherSummary && !astro.weatherUnavailable
      ? astro.weatherSummary
      : day.weatherNote,
    day.weatherPrecip || (astro?.precipProb ? `осадки ${astro.precipProb}%` : null),
    astro?.weatherUnavailable ? astro.weatherSummary : null,
  ].filter(Boolean);

  const sceneById = new Map(day.scenes.map((s) => [s.scene.id, s]));

  return (
    <div className="call-sheet-root space-y-6 print:space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm text-[var(--muted-fg)]">
            <Link
              href={`/${locale}/projects/${projectId}/call-sheets`}
              className="hover:text-white"
            >
              ← Все вызывные
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
            Вызывной · День {day.dayNumber}
            {day.shiftNumber ? ` · Смена ${day.shiftNumber}` : ""}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <CallSheetEditor
              projectId={projectId}
              dayId={day.id}
              bundle={bundle}
              cast={cast}
              resources={resources}
            />
          ) : null}
          <PrintButton />
        </div>
      </div>

      <DocSection title="Съёмочный день">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-semibold print:text-lg">
              {project.fullName || project.name}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              {formatDate(day.date)}
              {project.city ? ` · ${project.city}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge>{shootDayTypeLabels[day.dayType]}</Badge>
              <Badge>{shootDayStatusLabels[day.status]}</Badge>
              {day.isNightShift ? <Badge>Ночная смена</Badge> : null}
              {day.isLocked ? <Badge>Зафиксирован</Badge> : null}
              {day.unit && day.unit !== "main" ? (
                <Badge>Группа {day.unit}</Badge>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <MetaGrid
            items={[
              { label: "№ смены", value: day.shiftNumber ?? "—" },
              { label: "День / ночь", value: dayNight },
              {
                label: "Погода",
                value: weatherParts.join(" · ") || "—",
              },
              { label: "Восход", value: astro?.sunrise || "—" },
              { label: "Закат", value: astro?.sunset || "—" },
              { label: "Сбор группы", value: day.crewMeetTime || day.callTime || "—" },
              {
                label: "Место сбора",
                value: day.crewMeetAddress || "—",
              },
            ]}
          />
          <MetaGrid
            items={[
              { label: "Начало смены", value: day.shiftStartTime || day.callTime || "—" },
              { label: "Репетиция", value: day.rehearsalTime || "—" },
              { label: "Мотор", value: day.motorOnTime || "—" },
              { label: "Стоп-мотор", value: day.motorOffTime || "—" },
              { label: "Конец смены", value: day.wrapTime || "—" },
              { label: "Сцены", value: stats.sceneCount },
              { label: "Хронометраж", value: stats.timingLabel },
              { label: "Страницы", value: stats.pagesLabel },
            ]}
          />
        </div>

        {day.notes || day.comment ? (
          <p className="mt-4 rounded-xl border border-[var(--border)] bg-black/20 p-3 text-sm text-[var(--muted-fg)]">
            {[day.notes, day.comment].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {astro ? (
          <p className="mt-2 text-xs text-[var(--muted-fg)] print:hidden">
            Солнце и прогноз: {astro.label}
          </p>
        ) : null}
      </DocSection>

      {day.departmentCalls.length > 0 ? (
        <DocSection title="Руководители группы / контакты по цехам">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {day.departmentCalls.map((d) => (
              <div
                key={d.id}
                className="rounded-xl border border-[var(--border)] bg-black/15 p-3"
              >
                <p className="font-medium">{d.roleLabel}</p>
                <p className="text-sm">{d.personName || "—"}</p>
                <p className="mt-1 text-xs text-[var(--muted-fg)]">
                  {[d.callTime ? `явка ${d.callTime}` : null, d.phone]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
            ))}
          </div>
        </DocSection>
      ) : null}

      {day.transports.length > 0 ? (
        <DocSection title="Спецтранспорт">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {day.transports.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-[var(--border)] bg-black/15 p-3"
              >
                <p className="font-medium">{t.name}</p>
                <p className="text-sm text-[var(--muted-fg)]">
                  {t.callTime ? `прибытие ${t.callTime}` : "время не указано"}
                </p>
                {t.notes ? (
                  <p className="mt-1 text-xs text-[var(--muted-fg)]">{t.notes}</p>
                ) : null}
              </div>
            ))}
          </div>
        </DocSection>
      ) : null}

      <DocSection title="Расписание дня">
        {day.timeSlots.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">
            Расписание по слотам не задано. Добавьте слоты в режиме редактирования
            или используйте список сцен ниже как ориентир.
          </p>
        ) : (
          <div className="space-y-3">
            {day.timeSlots.map((slot) => {
              const assignment = slot.sceneId
                ? sceneById.get(slot.sceneId)
                : undefined;
              const details =
                slot.slotType === "SHOOTING" && assignment
                  ? buildShootingSlotDetails(
                      assignment.scene,
                      assignment.notes,
                    )
                  : null;

              return (
                <div
                  key={slot.id}
                  className="rounded-xl border border-[var(--border)] bg-black/15 p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-base font-semibold">
                        {slot.startTime}
                        {slot.endTime ? `–${slot.endTime}` : ""}
                      </span>
                      <Badge>{timeSlotTypeLabels[slot.slotType]}</Badge>
                      {slot.endTime ? (
                        <span className="text-xs text-[var(--muted-fg)]">
                          {slotDurationLabel(slot.startTime, slot.endTime)}
                        </span>
                      ) : null}
                    </div>
                    {details ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          sceneStatusColors[assignment!.scene.status]
                        }`}
                      >
                        {sceneStatusLabel(assignment!.scene.status)}
                      </span>
                    ) : null}
                  </div>

                  {details ? (
                    <div className="mt-3 space-y-2 border-t border-[var(--border)]/60 pt-3">
                      <p className="font-medium">
                        Сцена {details.sceneNumber}
                        {details.location ? ` · ${details.location}` : ""}
                        {details.scriptDay != null
                          ? ` · сценарный день ${details.scriptDay}`
                          : ""}
                      </p>
                      {details.locationAddress ? (
                        <p className="text-xs text-[var(--muted-fg)]">
                          {details.locationAddress}
                        </p>
                      ) : null}
                      <p className="text-sm text-[var(--muted-fg)]">
                        Хрон. {details.planLabel}
                        {details.summary ? ` · ${details.summary}` : ""}
                      </p>
                      <TagList items={details.characters} label="Персонажи" />
                      <TagList items={details.extras} label="Массовка" />
                      <TagList items={details.groups} label="Групповка" />
                      <TagList items={details.stunts} label="Каскадёры" />
                      <TagList items={details.makeup} label="Грим" />
                      <TagList items={details.costumes} label="Костюм" />
                      <TagList items={details.props} label="Реквизит" />
                      <TagList items={details.vehicles} label="Транспорт" />
                      <TagList items={details.camera} label="Операторская" />
                      {details.notes ? (
                        <p className="text-xs text-[var(--muted-fg)]">
                          Примечание: {details.notes}
                        </p>
                      ) : null}
                    </div>
                  ) : slot.notes ? (
                    <p className="mt-2 text-sm text-[var(--muted-fg)]">{slot.notes}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </DocSection>

      <DocSection title="Актёры">
        {cast.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">
            В сценах дня нет персонажей.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                  <th className="py-2 pr-3">Персонаж</th>
                  <th className="py-2 pr-3">Актёр</th>
                  <th className="py-2 pr-3">Сцены</th>
                  <th className="py-2 pr-3">Подача</th>
                  <th className="py-2 pr-3">Прибытие</th>
                  <th className="py-2 pr-3">Костюм</th>
                  <th className="py-2 pr-3">Грим</th>
                  <th className="py-2 pr-3">Готовность / Конец</th>
                  <th className="py-2">Контакт</th>
                </tr>
              </thead>
              <tbody>
                {cast.map((row) => (
                  <tr
                    key={`${row.characterName}-${row.actorId ?? "na"}`}
                    className="border-b border-[var(--border)]/60"
                  >
                    <td className="py-2 pr-3 font-medium">{row.characterName}</td>
                    <td className="py-2 pr-3">
                      {row.actorName || (
                        <span className="text-[var(--muted-fg)]">не назначен</span>
                      )}
                      {row.roleType ? (
                        <span className="ml-1 text-xs text-[var(--muted-fg)]">
                          (
                          {
                            actorRoleTypeLabels[
                              row.roleType as keyof typeof actorRoleTypeLabels
                            ]
                          }
                          )
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted-fg)]">
                      {row.sceneNumbers.join(", ")}
                    </td>
                    <td className="py-2 pr-3">{row.pickup || "—"}</td>
                    <td className="py-2 pr-3">{row.arrival || "—"}</td>
                    <td className="py-2 pr-3">{row.costume || "—"}</td>
                    <td className="py-2 pr-3">{row.makeup || "—"}</td>
                    <td className="py-2 pr-3">
                      <TimingPair ready={row.ready} wrap={row.wrap} />
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
      </DocSection>

      {resources.extras.length > 0 ? (
        <DocSection title="Массовка">
          <ResourceTable rows={resources.extras} />
        </DocSection>
      ) : null}

      {resources.stunts.length > 0 ? (
        <DocSection title="Трюк / каскадёры">
          <ResourceTable rows={resources.stunts} showCostume={false} showMakeup={false} />
        </DocSection>
      ) : null}

      {resources.art.length > 0 ? (
        <DocSection title="Художественный цех">
          <ResourceTable rows={resources.art} showMakeup={false} />
        </DocSection>
      ) : null}

      {resources.camera.length > 0 ? (
        <DocSection title="Операторская техника">
          <ResourceTable
            rows={resources.camera}
            showCostume={false}
            showMakeup={false}
          />
        </DocSection>
      ) : null}

      {resources.props.length > 0 ? (
        <DocSection title="Реквизит">
          <ResourceTable rows={resources.props} showMakeup={false} />
        </DocSection>
      ) : null}

      {resources.vehicles.length > 0 ? (
        <DocSection title="Игровой транспорт / спецтехника на сцену">
          <ResourceTable
            rows={resources.vehicles}
            showCostume={false}
            showMakeup={false}
          />
        </DocSection>
      ) : null}

      <DocSection title="Сцены дня (сводка)">
        {day.scenes.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">В дне нет сцен.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                  <th className="py-2 pr-3">Сцена</th>
                  <th className="py-2 pr-3">Персонажи</th>
                  <th className="py-2 pr-3">Хрон.</th>
                  <th className="py-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {day.scenes.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border)]/60">
                    <td className="py-2 pr-3 font-medium">
                      {formatSceneLine(row.scene)}
                    </td>
                    <td className="py-2 pr-3 text-[var(--muted-fg)]">
                      {row.scene.characters
                        .map((c) => c.character.name)
                        .join(", ") || "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {formatPagesMinutes(
                        row.estimatedPages ?? row.scene.pageCount,
                        row.scene.planSeconds,
                      )}
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          sceneStatusColors[row.scene.status]
                        }`}
                      >
                        {sceneStatusLabel(row.scene.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {stats.locations.length > 0 ? (
          <p className="mt-3 text-xs text-[var(--muted-fg)]">
            Объекты: {stats.locations.join(", ")}
          </p>
        ) : null}
      </DocSection>

      {nextDay ? (
        <DocSection title="Следующий съёмочный день" className="print:break-before-page">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              День {nextDay.dayNumber} · {formatShortDate(nextDay.date)}
            </p>
            {nextDayAstro ? (
              <p className="text-sm text-[var(--muted-fg)]">
                ↑ {nextDayAstro.sunrise || "—"} · ↓ {nextDayAstro.sunset || "—"}
                {nextDayAstro.weatherSummary
                  ? ` · ${nextDayAstro.weatherSummary}`
                  : ""}
              </p>
            ) : null}
          </div>
          <p className="mt-2 text-sm">
            Сцены:{" "}
            {nextDay.scenes.length > 0
              ? nextDay.scenes
                  .map((s) => {
                    const sc = s.scene;
                    const ep = sc.episodeNumber > 0 ? `${sc.episodeNumber}-` : "";
                    return `${ep}${sc.number}${sc.postfix}`;
                  })
                  .join(", ")
              : "не запланированы"}
          </p>
          {nextDay.scenes.length > 0 ? (
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              Объекты:{" "}
              {[
                ...new Set(
                  nextDay.scenes.flatMap((s) =>
                    s.scene.locations.map((l) => l.location.name),
                  ),
                ),
              ].join(", ")}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-[var(--muted-fg)]">
            <Link
              href={`/${locale}/projects/${projectId}/call-sheets/${nextDay.id}`}
              className="hover:text-white print:hidden"
            >
              Открыть вызывной →
            </Link>
          </p>
        </DocSection>
      ) : null}
    </div>
  );
}
