"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from "@/features/auth/schemas";
import {
  buildPasswordResetUrl,
  createPasswordResetToken,
  hashPasswordResetToken,
  sendPasswordResetEmail,
} from "@/features/auth/lib/password-reset";
import { prisma } from "@/shared/db/prisma";

export type ActionState = {
  error?: string;
  success?: string;
  devResetUrl?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error: "Проверьте правильность заполнения формы",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Пользователь с таким email уже зарегистрирован" };
  }

  const name = `${parsed.data.firstName} ${parsed.data.lastName}`.trim();
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
    },
  });

  try {
    await signIn("credentials", {
      email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Аккаунт создан, но не удалось войти. Попробуйте войти вручную." };
    }
    throw error;
  }

  const callbackUrl = formData.get("callbackUrl");
  redirect(
    typeof callbackUrl === "string" && callbackUrl.startsWith("/")
      ? callbackUrl
      : "/ru/projects",
  );
}

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Введите корректный email и пароль" };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email.toLowerCase(),
      password: parsed.data.password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Неверный email или пароль" };
    }
    throw error;
  }

  const callbackUrl = formData.get("callbackUrl");
  redirect(
    typeof callbackUrl === "string" && callbackUrl.startsWith("/")
      ? callbackUrl
      : "/ru/projects",
  );
}

export async function logoutAction() {
  await signOut({ redirectTo: "/ru/login" });
}

const forgotPasswordSuccess =
  "Если аккаунт с таким email существует, мы отправили ссылку для сброса пароля.";

export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { error: "Введите корректный email" };
  }

  const email = parsed.data.email.toLowerCase();
  const locale =
    typeof formData.get("locale") === "string" ? String(formData.get("locale")) : "ru";

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { success: forgotPasswordSuccess };
  }

  const { plainToken, tokenHash, expiresAt } = createPasswordResetToken();

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    }),
  ]);

  const resetUrl = buildPasswordResetUrl(locale, plainToken);
  const mail = await sendPasswordResetEmail(email, resetUrl);

  if (mail.sent) {
    return { success: forgotPasswordSuccess };
  }

  if (process.env.NODE_ENV === "development") {
    console.info("[password-reset] dev link:", resetUrl);
    return {
      success: forgotPasswordSuccess,
      devResetUrl: resetUrl,
    };
  }

  return {
    error:
      mail.reason ??
      "Почта не настроена. Обратитесь к администратору или задайте RESEND_API_KEY на сервере.",
  };
}

export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error: "Проверьте пароль (минимум 8 символов) и попробуйте снова",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const tokenHash = hashPasswordResetToken(parsed.data.token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { error: "Ссылка недействительна или устарела. Запросите сброс снова." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
      data: { usedAt: new Date() },
    }),
  ]);

  redirect("/ru/login?reset=1");
}
