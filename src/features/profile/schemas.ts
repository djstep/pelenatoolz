import { z } from "zod";
import { optionalPhoneSchema } from "@/shared/lib/phone";

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Укажите имя и фамилию").max(160, "Имя слишком длинное"),
  phone: optionalPhoneSchema,
  googleEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(255, "Почта слишком длинная")
    .refine((v) => v === "" || z.email().safeParse(v).success, "Почта для Google — в виде name@gmail.com")
    .transform((v) => (v === "" ? null : v)),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/** Смена пароля: правила нового пароля проверяет `passwordProblem`, там нужна почта. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Введите текущий пароль").max(128, "Неверный текущий пароль"),
    newPassword: z.string(),
    newPasswordRepeat: z.string(),
  })
  .refine((data) => data.newPassword === data.newPasswordRepeat, {
    message: "Новый пароль и повтор не совпадают",
    path: ["newPasswordRepeat"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "Новый пароль совпадает с текущим",
    path: ["newPassword"],
  });

/**
 * Что пишем в журнал об изменении профиля: имя — как есть, телефон и почта — только факт
 * изменения (персональные данные в журнал не попадают).
 */
export function profileAuditChanges(before: ProfileInput, after: ProfileInput) {
  const changes: Record<string, unknown> = {};
  if (before.name !== after.name) changes.name = { from: before.name, to: after.name };
  if (before.phone !== after.phone) changes.phoneChanged = true;
  if (before.googleEmail !== after.googleEmail) changes.googleEmailChanged = true;
  return changes;
}
