import { z } from "zod";
import { CREW_SYNC_FIELDS } from "@/features/crew/lib/crew-sync";

function emptyToNull(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
}

const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().max(max).nullable());

const optionalCuid = z.preprocess(emptyToNull, z.string().cuid().nullable());

export const crewMemberFormSchema = z.object({
  lastName: z.string().trim().min(1, "Укажите фамилию").max(100),
  firstName: optionalText(100),
  middleName: optionalText(100),
  position: optionalText(200),
  departmentId: optionalCuid,
  note: optionalText(2000),
  phone: optionalText(40),
  email: z.preprocess(
    emptyToNull,
    z.string().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Проверьте почту").nullable(),
  ),
});

export const reorderCrewSchema = z.array(z.string().cuid()).min(1).max(1000);

export const crewIdSchema = z.string().cuid();

/** Каждая строка окна «Подтянуть»: новый человек или договор к существующему. */
export const crewPullSchema = z
  .array(
    z.discriminatedUnion("mode", [
      z.object({
        mode: z.literal("create"),
        counterpartyId: crewIdSchema,
        person: crewMemberFormSchema,
      }),
      z.object({
        mode: z.literal("link"),
        counterpartyId: crewIdSchema,
        memberId: crewIdSchema,
      }),
    ]),
  )
  .min(1, "Никто не выбран")
  .max(100, "За раз можно подтянуть до 100 человек");

/** Запрос выгрузки. Какие поля из него попадут в файл, решает `crewExportColumns` по правам. */
export const crewExportSchema = z.object({
  format: z.enum(["xlsx", "pdf"]),
  columns: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        title: z.string().max(200),
        fieldIds: z.array(z.string().max(50)).max(50),
      }),
    )
    .min(1)
    .max(50),
  includeArchived: z.boolean().optional(),
});

export const crewSyncFieldsSchema = z.array(z.enum(CREW_SYNC_FIELDS)).min(1).max(CREW_SYNC_FIELDS.length);
