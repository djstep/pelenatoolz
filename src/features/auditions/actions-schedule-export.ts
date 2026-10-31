"use server";

import { z } from "zod";
import {
  addDays,
  parseDateKey,
  startOfWeekMonday,
} from "@/features/actor-availability/lib/status";
import {
  buildScheduleDocx,
  buildSchedulePrintHtml,
  scheduleExportFieldLabels,
  schedulePhotoUrls,
  type ScheduleExportField,
} from "@/features/auditions/lib/export-schedule";
import {
  listAuditionSchedules,
} from "@/features/auditions/lib/schedule-queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import {
  EXPORT_IMAGES_PARTIAL_WARNING,
  loadExportImages,
} from "@/shared/lib/export-image";

const isValidDate = (value: string) => !Number.isNaN(Date.parse(value));

const exportPayloadSchema = z.object({
  scope: z.enum(["all", "week", "day"]),
  weekAnchorIso: z.string().max(64).refine(isValidDate).optional(),
  dayKey: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidDate)
    .optional(),
  format: z.enum(["docx", "pdf"]),
  fields: z.array(
    z.enum(Object.keys(scheduleExportFieldLabels) as ScheduleExportField[]),
  ),
});

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

  const parsed = exportPayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: "Некорректные настройки экспорта" };
  const { scope, weekAnchorIso, dayKey, format } = parsed.data;

  let from: Date | undefined;
  let to: Date | undefined;
  if (scope === "week") {
    const anchor = weekAnchorIso ? new Date(weekAnchorIso) : new Date();
    from = startOfWeekMonday(anchor);
    to = addDays(from, 6);
  } else if (scope === "day") {
    if (!dayKey) return { error: "Не выбрана дата" };
    from = parseDateKey(dayKey);
    to = from;
  }

  const [schedules, project] = await Promise.all([
    listAuditionSchedules(projectId, { from, to }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, fullName: true },
    }),
  ]);

  if (schedules.length === 0) {
    return { error: "Нет запланированных проб для экспорта" };
  }

  const projectName = project?.fullName || project?.name || "Проект";
  const fields =
    parsed.data.fields.length > 0
      ? parsed.data.fields
      : ([
          "time",
          "kind",
          "photo",
          "name",
          "character",
          "notesBlank",
        ] as ScheduleExportField[]);

  if (format === "docx") {
    const photos = await loadExportImages(
      projectId,
      schedulePhotoUrls(schedules, fields),
    );
    const buf = await buildScheduleDocx(projectName, schedules, fields, photos);
    return {
      base64: buf.toString("base64"),
      fileName: `audition-schedule.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ...(photos.partial ? { warning: EXPORT_IMAGES_PARTIAL_WARNING } : {}),
    };
  }

  return {
    html: buildSchedulePrintHtml(projectName, schedules, fields),
    fileName: `audition-schedule.html`,
  };
}
