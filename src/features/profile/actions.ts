"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { LOGIN_RATE_LIMIT } from "@/features/auth/lib/login-limit";
import { passwordProblem } from "@/features/auth/lib/password-rules";
import { requireUser } from "@/features/auth/session";
import { scheduleUserDriveAccessSync } from "@/features/cloud/lib/drive-access-sync";
import { changePasswordSchema, profileAuditChanges, profileSchema } from "@/features/profile/schemas";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";
import { checkRateLimit, resetRateLimit } from "@/shared/lib/rate-limit";

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

/**
 * Своя смена пароля по текущему паролю. Украденная сессия не должна подбирать пароль через эту
 * форму, поэтому у неё тот же лимит, что у входа. Счётчик на пользователя, в ключе только его id.
 * Остальные устройства выходят: растёт номер сессий. Текущему выдаётся новая сессия.
 */
export async function changePasswordAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const sessionUser = await requireUser();
  const userId = sessionUser.id!;

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    newPasswordRepeat: formData.get("newPasswordRepeat"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true },
  });
  if (!user) return { error: "Пользователь не найден" };

  const problem = passwordProblem(newPassword, user.email);
  if (problem) return { error: problem };

  const limitKey = `password-change:${userId}`;
  const { allowed } = await checkRateLimit(limitKey, LOGIN_RATE_LIMIT);
  if (!allowed) return { error: "Слишком много попыток. Попробуйте позже." };

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return { error: "Неверный текущий пароль" };
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.$transaction(async (tx) => {
    await auditMutation(
      { user: { id: userId } },
      async () => {
        await tx.user.update({
          where: { id: userId },
          data: { passwordHash, sessionVersion: { increment: 1 } },
        });
        // Ссылки сброса, выданные раньше, не должны пережить смену пароля.
        await tx.passwordResetToken.updateMany({
          where: { userId, usedAt: null },
          data: { usedAt: new Date() },
        });
      },
      null,
      {
        projectId: null,
        entityType: AuditEntityType.userPassword,
        entityId: userId,
        action: "UPDATE",
        summary: "Изменён пароль",
      },
      { db: tx },
    );
  });
  await resetRateLimit(limitKey);

  try {
    await signIn("credentials", { email: user.email, password: newPassword, redirect: false });
  } catch (error) {
    // Пароль уже сменён, но новую сессию не выдали (например, вход заблокирован лимитом).
    if (error instanceof AuthError) redirect("/ru/login");
    throw error;
  }

  // Не просто ответ, а переход: страница после действия показывается по куке из запроса, то есть
  // по старой сессии, и выкинула бы человека на вход. Переход идёт уже с новой сессией.
  redirect(`/ru/profile?passwordChanged=${Date.now()}`);
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
