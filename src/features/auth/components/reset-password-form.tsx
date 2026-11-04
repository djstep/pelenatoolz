"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  resetPasswordAction,
  type ActionState,
} from "@/features/auth/actions";
import { NewPasswordField } from "@/features/auth/components/new-password-field";
import { Button } from "@/shared/ui/button";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";

const initial: ActionState = {};

export function ResetPasswordForm({
  locale,
  token,
}: {
  locale: string;
  token: string;
}) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(resetPasswordAction, initial);

  if (!token) {
    return (
      <div className="space-y-4 text-sm text-[var(--muted-fg)]">
        <p>{t("resetPasswordInvalid")}</p>
        <Link
          href={`/${locale}/forgot-password`}
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          {t("forgotPasswordCta")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submitKeepingFields(action)} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-[var(--muted-fg)]">{t("resetPasswordHint")}</p>
      <NewPasswordField label={t("newPassword")} />
      {state.error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "…" : t("resetPasswordCta")}
      </Button>
    </form>
  );
}
