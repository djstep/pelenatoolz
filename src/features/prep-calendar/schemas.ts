import { z } from "zod";
import { PREP_EVENT_COLORS } from "@/features/prep-calendar/lib/event-colors";

const COLOR_KEYS = PREP_EVENT_COLORS.map((c) => c.key) as [string, ...string[]];

export const prepEventTypeFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Укажите название")
    .max(60, "Название — не длиннее 60 символов"),
  color: z.enum(COLOR_KEYS, { message: "Выберите цвет" }),
});

function emptyToNull(value: unknown) {
  const text = typeof value === "string" ? value.trim() : value;
  return text === "" || text === undefined ? null : text;
}

const optionalText = (max: number, message: string) =>
  z.preprocess(emptyToNull, z.string().max(max, message).nullable());

/**
 * Id из браузера: только непустая строка. Формат не проверяется: у типов из миграции id не cuid.
 * Принадлежность проекту проверяет `assertInProject`.
 */
const idSchema = z.string().min(1).max(64);
const idList = z.array(idSchema).max(300).transform((ids) => [...new Set(ids)]);

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Укажите время в виде ЧЧ:ММ");

export const prepEventInputSchema = z
  .object({
    title: z.string().trim().min(1, "Укажите название").max(200, "Название — не длиннее 200 символов"),
    typeId: z.string({ message: "Выберите тип" }).min(1, "Выберите тип").max(64),
    allDay: z.boolean(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату начала"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату окончания"),
    startTime: z.preprocess(emptyToNull, timeSchema.nullable()),
    endTime: z.preprocess(emptyToNull, timeSchema.nullable()),
    locationId: z.preprocess(emptyToNull, idSchema.nullable()),
    locationText: optionalText(300, "Место — не длиннее 300 символов"),
    note: optionalText(5000, "Заметка — не длиннее 5000 символов"),
    crewMemberIds: idList,
    actorIds: idList,
    castingPersonIds: idList,
    departmentIds: idList,
    /** Пересечения показаны и человек нажал «Сохранить всё равно». */
    confirmOverlaps: z.boolean().optional(),
  })
  .refine((data) => data.allDay || (data.startTime && data.endTime), {
    message: "Укажите время начала и окончания",
  });

export type PrepEventInput = z.infer<typeof prepEventInputSchema>;
