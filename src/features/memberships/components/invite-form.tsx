"use client";

import { useRef, useState, type FormEvent } from "react";
import { useSafeActionState } from "@/shared/ui/forms/use-safe-action-state";
import { useTranslations } from "next-intl";
import {
  createInviteAction,
  type ActionState,
} from "@/features/projects/actions";
import { Button } from "@/shared/ui/button";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { useFormGuard } from "@/shared/ui/unsaved/use-form-guard";
import { useOnChange } from "@/shared/hooks/use-on-change";

const initial: ActionState = {};

type RoleOption = { id: string; name: string };

export function InviteForm({
  projectId,
  roles,
}: {
  projectId: string;
  roles: RoleOption[];
}) {
  const t = useTranslations("members");
  const bound = createInviteAction.bind(null, projectId);
  const [state, action, pending] = useSafeActionState(bound, initial);
  const [copied, setCopied] = useState(false);
  const defaultRoleId = roles.find((r) => r.name === "Наблюдатель")?.id ?? roles[0]?.id;
  // Форма на самой странице: при уходе с введёнными данными — обычный вопрос о сохранении.
  const { ref, markClean } = useFormGuard(true, undefined, state);
  const toast = useToast();
  // Новая форма после успеха даёт пустые поля; при ошибке сервера введённое остаётся.
  const [formKey, setFormKey] = useState(0);
  const leavingPage = useRef(false);
  useActionSuccess(state, () => {
    setFormKey((key) => key + 1);
    markClean();
    // Отправка из вопроса о переходе: блока со ссылкой человек не увидит, скажем, где она.
    if (leavingPage.current) {
      toast.success("Приглашение создано. Ссылка — в «Активных приглашениях» на странице участников");
    }
  });
  const submit = submitKeepingFields(action);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Вопрос о переходе отправляет форму без кнопки, сама кнопка и Enter — с ней.
    leavingPage.current = !(event.nativeEvent as SubmitEvent).submitter;
    submit(event);
  }

  useOnChange([state.inviteUrl], () => {
    setCopied(false);
  });

  async function copyLink() {
    if (!state.inviteUrl) return;
    await navigator.clipboard.writeText(state.inviteUrl);
    setCopied(true);
  }

  return (
    <form key={formKey} ref={ref} onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="email">{t("inviteEmail")}</Label>
        <Input id="email" name="email" type="email" />
      </div>
      <div>
        <Label htmlFor="roleId">{t("inviteRole")}</Label>
        <Select id="roleId" name="roleId" defaultValue={defaultRoleId} required>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="expiresInDays">{t("inviteExpires")}</Label>
        <Input
          id="expiresInDays"
          name="expiresInDays"
          type="number"
          min={1}
          max={30}
          placeholder="7"
        />
      </div>
      {state.error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.inviteUrl ? (
        <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <p className="break-all text-sm text-[var(--muted-fg)]">
            {state.inviteUrl}
          </p>
          <Button type="button" variant="secondary" onClick={copyLink}>
            {copied ? "Скопировано" : t("copyLink")}
          </Button>
        </div>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "…" : t("createLink")}
      </Button>
    </form>
  );
}
