"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { scheduleUserDriveAccessSync } from "@/features/cloud/lib/drive-access-sync";
import { profileAuditChanges, profileSchema } from "@/features/profile/schemas";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type ProfileFormValues = { name: string; phone: string; googleEmail: string };

export type ProfileActionState = {
  error?: string;
  success?: string;
  values?: ProfileFormValues;
};

function formValues(formData: FormData): ProfileFormValues {
  return {
    name: String(formData.get("name") ?? "").slice(0, 160),
    phone: String(formData.get("phone") ?? "").slice(0, 30),
    googleEmail: String(formData.get("googleEmail") ?? "").slice(0, 255),
  };
}

/** Свой профиль: имя, телефон, почта для Google. Меняет только вошедший пользователь — себя. */
export async function updateProfileAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireUser();
  const userId = user.id!;

  const parsed = profileSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Некорректные данные",
      values: formValues(formData),
    };
  }
  const next = parsed.data;

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, phone: true, googleEmail: true },
  });
  if (!before) return { error: "Пользователь не найден" };

  const changes = profileAuditChanges(before, next);
  if (Object.keys(changes).length === 0) return { success: "Профиль сохранён" };

  await auditMutation(
    { user: { id: userId } },
    async (data: typeof next) => {
      await prisma.user.update({ where: { id: userId }, data });
    },
    next,
    {
      projectId: null,
      entityType: AuditEntityType.userProfile,
      entityId: userId,
      action: "UPDATE",
      summary: "Изменён профиль",
      changes,
    },
  );

  // Доступы к папкам дисков проектов — на новую почту, во всех проектах, после ответа.
  if (changes.googleEmailChanged) scheduleUserDriveAccessSync(userId, "google_email");

  revalidatePath("/ru/profile");
  // Имя в шапке и в списках участников.
  revalidatePath("/ru", "layout");
  return { success: "Профиль сохранён" };
}
