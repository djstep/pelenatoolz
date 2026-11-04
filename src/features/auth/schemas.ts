import { z } from "zod";
import { PERSONAL_DATA_CONSENT_REQUIRED } from "@/features/auth/lib/personal-data-consent";
import { passwordProblem } from "@/features/auth/lib/password-rules";

/** Новый пароль без сверки с почтой (почта бывает известна позже, как при сбросе). */
const newPasswordSchema = z.string().superRefine((value, ctx) => {
  const problem = passwordProblem(value);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.email().max(255),
    password: newPasswordSchema,
    personalDataConsent: z.literal("on", { error: PERSONAL_DATA_CONSENT_REQUIRED }),
  })
  .superRefine((data, ctx) => {
    const problem = passwordProblem(data.password, data.email);
    if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["password"] });
  });

export const loginSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(1).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.email().max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(256),
  password: newPasswordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
