import { CalendarWorkspace } from "@/features/prep-calendar/components/calendar-workspace";
import {
  parseCalendarDate,
  parseCalendarView,
  visibleRange,
} from "@/features/prep-calendar/lib/calendar-view";
import { todayDateKey } from "@/features/prep-calendar/lib/zoned-time";
import {
  calendarRights,
  listCalendarEvents,
  listCalendarOptions,
} from "@/features/prep-calendar/queries";
import { listPulledItems } from "@/features/prep-calendar/pulled-queries";
import type { PulledSources } from "@/features/prep-calendar/lib/calendar-types";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PrepCalendarPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("calendar:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const query = await searchParams;
  const timezone = ctx.project.timezone;
  const today = todayDateKey(timezone);
  const addressView = parseCalendarView(query.view);
  const view = addressView ?? "month";
  const date = parseCalendarDate(query.date, today);
  const range = visibleRange(view, date);
  const rights = calendarRights(ctx.can);
  // Источник без права не запрашивается и переключателя не получает.
  const sources: PulledSources = {
    auditions: rights.canReadCast ? query.auditions !== "0" : null,
    kpp: rights.canReadSchedule ? query.kpp !== "0" : null,
  };
  const extra: Record<string, string> = {};
  if (sources.auditions === false) extra.auditions = "0";
  if (sources.kpp === false) extra.kpp = "0";
  const projectPath = `/${locale}/projects/${ctx.project.id}`;

  const [events, pulled, options] = await Promise.all([
    listCalendarEvents(ctx.project.id, timezone, range, rights),
    listPulledItems(
      ctx.project.id,
      timezone,
      range,
      { auditions: sources.auditions === true, kpp: sources.kpp === true },
      projectPath,
    ),
    rights.canWrite ? listCalendarOptions(ctx.project.id, rights) : null,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[27px] font-bold leading-tight">
          Календарь препродакшена
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Встречи, читки, выбор объектов, примерки и другие события подготовки.
        </p>
      </div>
      <Card>
        <CalendarWorkspace
          projectId={ctx.project.id}
          basePath={`${projectPath}/preproduction/calendar`}
          view={view}
          viewFromAddress={addressView !== null}
          date={date}
          today={today}
          range={range}
          timezone={timezone}
          items={[...events, ...pulled]}
          sources={sources}
          query={extra}
          options={options}
        />
      </Card>
    </div>
  );
}
