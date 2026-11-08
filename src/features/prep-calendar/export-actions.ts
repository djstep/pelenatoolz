"use server";

import { z } from "zod";
import { parseExportSettings } from "@/features/exports/lib/column-utils";
import { parseDateKey } from "@/features/actor-availability/lib/status";
import {
  allowedFilters,
  loadCalendarItems,
  pulledSourcesFromQuery,
} from "@/features/prep-calendar/calendar-items";
import {
  CALENDAR_EXPORT_LAYOUT_KEY,
  calendarDefaultExportColumns,
  calendarExportColumns,
  groupCalendarItemsByDay,
} from "@/features/prep-calendar/lib/calendar-export";
import { buildCalendarPrintHtml } from "@/features/prep-calendar/lib/calendar-export-print";
import { buildCalendarWorkbook } from "@/features/prep-calendar/lib/calendar-export-xlsx";
import { parseCalendarFilters } from "@/features/prep-calendar/lib/calendar-filters";
import { eachDayKey } from "@/features/prep-calendar/lib/calendar-view";
import { isDateKey } from "@/features/prep-calendar/lib/event-dates";
import { calendarRights } from "@/features/prep-calendar/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { formatDateRange } from "@/shared/i18n/format-date";
import { prisma } from "@/shared/db/prisma";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Больше года за раз не выгружаем: такой файл никто не читает, а сервер занят. */
const MAX_DAYS = 370;

export type CalendarExportResult =
  | { error: string }
  | { html: string }
  | { base64: string; fileName: string; mime: string };

const exportSchema = z.object({
  format: z.enum(["xlsx", "pdf"]),
  /** Пусто — раскладка проекта, а без неё — все поля по порядку (печать недели одной кнопкой). */
  columns: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        title: z.string().max(200),
        fieldIds: z.array(z.string().max(50)).max(50),
      }),
    )
    .max(50),
  from: z.string().refine(isDateKey, "Укажите начало периода"),
  to: z.string().refine(isDateKey, "Укажите конец периода"),
  title: z.enum(["list", "week"]).optional(),
  /** Параметры адреса экрана: фильтры и переключатели источников. Права сервер решает сам. */
  query: z.record(z.string(), z.string().max(200)).default({}),
});

/**
 * Список за период в Excel или на печать. Строки собираются тем же кодом, что и экран: те же
 * права, фильтры и переключатели. Из запроса берутся только период, фильтры и колонки.
 */
export async function exportCalendarAction(
  rawProjectId: string,
  input: unknown,
): Promise<CalendarExportResult> {
  const ctx = await requireProjectContext(rawProjectId);
  if (!ctx.can("calendar:read")) return { error: "Недостаточно прав" };
  const projectId = ctx.project.id;

  const parsed = exportSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте период" };
  const { format, from, to, query } = parsed.data;
  if (to < from) return { error: "Конец периода раньше начала" };
  if (eachDayKey({ from, to }).length > MAX_DAYS) return { error: "Период — не больше года" };

  let columns = calendarExportColumns(parsed.data.columns);
  if (columns.length === 0) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { exportSettings: true },
    });
    const saved = parseExportSettings(project?.exportSettings)[CALENDAR_EXPORT_LAYOUT_KEY];
    columns = calendarExportColumns(saved?.columns ?? []);
    if (columns.length === 0) columns = calendarDefaultExportColumns();
  }

  const rights = calendarRights(ctx.can);
  const items = await loadCalendarItems({
    projectId,
    timezone: ctx.project.timezone,
    range: { from, to },
    can: ctx.can,
    filters: allowedFilters(rights, parseCalendarFilters(query)),
    sources: pulledSourcesFromQuery(rights, query),
    projectPath: `/ru/projects/${projectId}`,
  });

  const period = formatDateRange(parseDateKey(from), parseDateKey(to), { utc: true });
  if (format === "pdf") {
    return {
      html: buildCalendarPrintHtml({
        title: parsed.data.title === "week" ? "Неделя препродакшена" : "Календарь препродакшена",
        period,
        projectName: ctx.project.name,
        columns,
        groups: groupCalendarItemsByDay(items),
      }),
    };
  }
  const buffer = await buildCalendarWorkbook(columns, items);
  return {
    base64: buffer.toString("base64"),
    fileName: `Календарь · ${from} – ${to}.xlsx`,
    mime: XLSX_MIME,
  };
}
