"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  registerAction,
  type ActionState,
} from "@/features/auth/actions";
import { NewPasswordField } from "@/features/auth/components/new-password-field";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

const initial: ActionState = {};

export function RegisterForm({
  callbackUrl,
  locale,
}: {
  callbackUrl?: string;
  locale: string;
}) {
  const t = useTranslations("auth");
  const tNav = useTranslations("nav");
  const [state, action, pending] = useActionState(registerAction, initial);
  const [email, setEmail] = useState("");

  return (
    <form onSubmit={submitKeepingFields(action)} className="space-y-4">
      {callbackUrl ? (
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="firstName">{t("firstName")}</Label>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            required
          />
        </div>
        <div>
          <Label htmlFor="lastName">{t("lastName")}</Label>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <NewPasswordField label={t("password")} email={email} />
      <Checkbox name="personalDataConsent" required className="items-start">
        <span>
          {t("consentBeforeLink")}{" "}
          <Link
            href={`/${locale}/privacy`}
            target="_blank"
            className="text-[var(--accent)] underline-offset-2 hover:underline"
          >
            {t("consentLink")}
          </Link>
        </span>
      </Checkbox>
      {state.error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "…" : t("registerCta")}
      </Button>
      <p className="text-center text-sm text-[var(--muted-fg)]">
        {t("hasAccount")}{" "}
        <Link
          href={`/${locale}/login${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          {tNav("login")}
        </Link>
      </p>
    </form>
  );
}
