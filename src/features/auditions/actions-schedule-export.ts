"use server";

import {
  addDays,
  parseDateKey,
  startOfWeekMonday,
} from "@/features/actor-availability/lib/status";
import {
  buildScheduleDocx,
  buildSchedulePrintHtml,
  type ScheduleExportField,
} from "@/features/auditions/lib/export-schedule";
import {
  listAuditionScheduleBreaks,
  listAuditionSchedules,
} from "@/features/auditions/lib/schedule-queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

export async function exportAuditionScheduleAction(
  projectId: string,
  payload: {
    scope: "all" | "week" | "day";
    weekAnchorIso?: string;
    dayKey?: string;
    format: "docx" | "pdf";
    fields: ScheduleExportField[];
  },
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("cast:read")) return { error: "Недостаточно прав" };

  let from: Date | undefined;
  let to: Date | undefined;
  if (payload.scope === "week") {
    const anchor = payload.weekAnchorIso
      ? new Date(payload.weekAnchorIso)
      : new Date();
    from = startOfWeekMonday(anchor);
    to = addDays(from, 6);
  } else if (payload.scope === "day") {
    if (!payload.dayKey) return { error: "Не выбрана дата" };
    from = parseDateKey(payload.dayKey);
    to = from;
  }

  const [schedules, breaks, project] = await Promise.all([
    listAuditionSchedules(projectId, { from, to }),
    listAuditionScheduleBreaks(projectId, { from, to }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, fullName: true },
    }),
  ]);

  if (schedules.length === 0 && breaks.length === 0) {
    return { error: "Нет запланированных проб для экспорта" };
  }

  const projectName = project?.fullName || project?.name || "Проект";
  const fields =
    payload.fields?.length > 0
      ? payload.fields
      : ([
          "time",
          "kind",
          "photo",
          "name",
          "character",
          "notesBlank",
        ] as ScheduleExportField[]);

  if (payload.format === "docx") {
    const buf = await buildScheduleDocx(projectName, schedules, fields, breaks);
    return {
      base64: buf.toString("base64"),
      fileName: `audition-schedule.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  return {
    html: buildSchedulePrintHtml(projectName, schedules, fields, breaks),
    fileName: `audition-schedule.html`,
  };
}
