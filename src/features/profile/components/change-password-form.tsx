"use client";

import { useSafeActionState } from "@/shared/ui/forms/use-safe-action-state";
import { NewPasswordField } from "@/features/auth/components/new-password-field";
import { changePasswordAction, type ProfileActionState } from "@/features/profile/actions";
import { Button } from "@/shared/ui/button";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

const initial: ProfileActionState = {};

/** Смена своего пароля. При успехе действие переводит на профиль с новым `key`, и поля очищаются. */
export function ChangePasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useSafeActionState(changePasswordAction, initial);

  return (
    <form
      onSubmit={submitKeepingFields(action)}
      className="max-w-xl space-y-4"
      data-testid="change-password-form"
    >
      {/* Менеджеру паролей: чей это пароль. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div>
        <Label htmlFor="current-password">Текущий пароль</Label>
        <Input
          id="current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <NewPasswordField
        label="Новый пароль"
        email={email}
        id="new-password"
        name="newPassword"
      />
      <div>
        <Label htmlFor="new-password-repeat">Новый пароль ещё раз</Label>
        <Input
          id="new-password-repeat"
          name="newPasswordRepeat"
          type="password"
          autoComplete="new-password"
          required
        />
        <p className="mt-1 text-xs text-[var(--muted-fg)]">
          После смены вы останетесь в системе на этом устройстве, на остальных вход сбросится.
        </p>
      </div>
      {state.error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "…" : "Сменить пароль"}
      </Button>
    </form>
  );
}
