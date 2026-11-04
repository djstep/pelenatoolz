import { z } from "zod";

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
