"use client";

import { useActionState } from "react";
import { updateProfileAction, type ProfileActionState } from "@/features/profile/actions";
import { PHONE_HINT } from "@/shared/lib/phone";
import { Button } from "@/shared/ui/button";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { useFormGuard } from "@/shared/ui/unsaved/use-form-guard";

const initial: ProfileActionState = {};

export function ProfileForm({
  email,
  profile,
}: {
  email: string;
  profile: { name: string; phone: string; googleEmail: string };
}) {
  const [state, action, pending] = useActionState(updateProfileAction, initial);
  useActionToast(state);
  const { ref, markClean } = useFormGuard<HTMLFormElement>(true, undefined, state);
  useActionSuccess(state, markClean);

  return (
    <form ref={ref} onSubmit={submitKeepingFields(action)} className="max-w-xl space-y-4">
      <div>
        <Label htmlFor="profile-email">Почта для входа</Label>
        <Input id="profile-email" value={email} disabled readOnly />
      </div>
      <div>
        <Label htmlFor="profile-name">Имя и фамилия *</Label>
        <Input
          id="profile-name"
          name="name"
          required
          maxLength={160}
          defaultValue={profile.name}
          autoComplete="name"
        />
        <p className="mt-1 text-xs text-[var(--muted-fg)]">
          Так вас видят участники проекта и в вызывных.
        </p>
      </div>
      <div>
        <Label htmlFor="profile-phone">Телефон</Label>
        <Input
          id="profile-phone"
          name="phone"
          type="tel"
          maxLength={30}
          defaultValue={profile.phone}
          placeholder="+7 999 123-45-67"
          autoComplete="tel"
        />
        <p className="mt-1 text-xs text-[var(--muted-fg)]">
          Попадает в вызывные, где вы — руководитель. Формат: {PHONE_HINT}.
        </p>
      </div>
      <div>
        <Label htmlFor="profile-google">Почта для Google</Label>
        <Input
          id="profile-google"
          name="googleEmail"
          type="email"
          maxLength={255}
          defaultValue={profile.googleEmail}
          placeholder="name@gmail.com"
        />
        <p className="mt-1 text-xs text-[var(--muted-fg)]">
          Аккаунт Google, на который выдавать доступ к файлам проекта на Диске. Может отличаться
          от почты для входа.
        </p>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "…" : "Сохранить"}
      </Button>
    </form>
  );
}
