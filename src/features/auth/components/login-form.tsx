"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  loginAction,
  type ActionState,
} from "@/features/auth/actions";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

const initial: ActionState = {};

export function LoginForm({
  callbackUrl,
  locale,
  resetSuccess,
}: {
  callbackUrl?: string;
  locale: string;
  resetSuccess?: boolean;
}) {
  const t = useTranslations("auth");
  const tNav = useTranslations("nav");
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <form action={action} className="space-y-4">
      {callbackUrl ? (
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
      ) : null}
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
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <Label htmlFor="password">{t("password")}</Label>
          <Link
            href={`/${locale}/forgot-password`}
            className="text-xs text-[var(--accent)] underline-offset-2 hover:underline"
          >
            {t("forgotPasswordLink")}
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {resetSuccess ? (
        <p className="text-sm text-emerald-400" role="status">
          {t("resetPasswordDone")}
        </p>
      ) : null}
      {state.error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "…" : t("loginCta")}
      </Button>
      <p className="text-center text-sm text-[var(--muted-fg)]">
        {t("noAccount")}{" "}
        <Link
          href={`/${locale}/register${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          {tNav("register")}
        </Link>
      </p>
    </form>
  );
}
