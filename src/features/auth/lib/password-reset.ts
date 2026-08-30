import { createHash, randomBytes } from "node:crypto";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function createPasswordResetToken() {
  const plainToken = randomBytes(32).toString("base64url");
  const tokenHash = hashPasswordResetToken(plainToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  return { plainToken, tokenHash, expiresAt };
}

export function hashPasswordResetToken(plainToken: string) {
  return createHash("sha256").update(plainToken).digest("hex");
}

export function appBaseUrl() {
  return (
    process.env.APP_URL?.replace(/\/$/, "") ??
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

export function buildPasswordResetUrl(locale: string, plainToken: string) {
  return `${appBaseUrl()}/${locale}/reset-password?token=${encodeURIComponent(plainToken)}`;
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.PASSWORD_RESET_FROM ?? "PELENA <onboarding@resend.dev>";

  if (!apiKey) {
    return { sent: false, reason: "RESEND_API_KEY не настроен" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Сброс пароля — PELENA",
      html: `
        <p>Вы запросили сброс пароля в PELENA.</p>
        <p><a href="${resetUrl}">Задать новый пароль</a></p>
        <p>Ссылка действует 1 час. Если это были не вы — просто проигнорируйте письмо.</p>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("Password reset email failed:", res.status, body);
    return { sent: false, reason: "Не удалось отправить письмо" };
  }

  return { sent: true };
}
