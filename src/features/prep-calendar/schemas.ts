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
