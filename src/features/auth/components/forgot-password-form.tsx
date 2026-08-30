"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  requestPasswordResetAction,
  type ActionState,
} from "@/features/auth/actions";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

const initial: ActionState = {};

export function ForgotPasswordForm({ locale }: { locale: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(
    requestPasswordResetAction,
    initial,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="locale" value={locale} />
      <p className="text-sm text-[var(--muted-fg)]">{t("forgotPasswordHint")}</p>
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      {state.error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="text-sm text-emerald-400" role="status">
          {state.success}
        </p>
      ) : null}
      {state.devResetUrl ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-xs text-amber-100">
          Режим разработки (письмо не отправлено):{" "}
          <a href={state.devResetUrl} className="underline">
            открыть ссылку сброса
          </a>
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "…" : t("forgotPasswordCta")}
      </Button>
      <p className="text-center text-sm text-[var(--muted-fg)]">
        <Link
          href={`/${locale}/login`}
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          {t("backToLogin")}
        </Link>
      </p>
    </form>
  );
}
