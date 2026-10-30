import { z } from "zod";

/** Префикс кодов статей: 2–6 знаков, буквы или цифры (кириллица/латиница), первая — буква. */
export const CODE_PREFIX_PATTERN = /^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9]{1,5}$/;

export const CODE_PREFIX_HINT =
  "2–6 букв или цифр, первая — буква (например ХУД, CAM2)";

export const departmentFormSchema = z.object({
  name: z.string().trim().min(1, "Укажите название цеха").max(100),
  codePrefix: z
    .string()
    .trim()
    .transform((v) => v.toLocaleUpperCase("ru"))
    .pipe(z.string().regex(CODE_PREFIX_PATTERN, `Префикс: ${CODE_PREFIX_HINT}`)),
  headMembershipIds: z.array(z.string().min(1).max(100)).max(100),
});

export type DepartmentFormInput = z.infer<typeof departmentFormSchema>;

export const reorderDepartmentsSchema = z
  .array(z.string().min(1).max(100))
  .min(1)
  .max(500);
