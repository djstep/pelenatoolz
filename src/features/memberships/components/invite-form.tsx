"use client";

import Link from "next/link";
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

type RoleOption = {
  id: string;
  name: string;
  /** Описание роли — под списком, когда роль выбрана. */
  note?: string | null;
  /** Роль из шаблона: кнопка быстрого выбора, по этому порядку. null — своя роль. */
  presetOrder?: number | null;
  /** Шаблон правит смету своего цеха — подсказать выбрать цех. */
  departmentHead?: boolean;
};

type DepartmentOption = { id: string; name: string };

export function InviteForm({
  projectId,
  locale = "ru",
  roles,
  departments = [],
}: {
  projectId: string;
  locale?: string;
  roles: RoleOption[];
  departments?: DepartmentOption[];
}) {
  const t = useTranslations("members");
  const bound = createInviteAction.bind(null, projectId);
  const [state, action, pending] = useSafeActionState(bound, initial);
  const [copied, setCopied] = useState(false);
  const defaultRoleId = roles.find((r) => r.name === "Наблюдатель")?.id ?? roles[0]?.id ?? "";
  const [roleId, setRoleId] = useState(defaultRoleId);
  const [departmentId, setDepartmentId] = useState("");
  const selectedRole = roles.find((r) => r.id === roleId);
  const presets = roles
    .filter((r) => r.presetOrder != null)
    .sort((a, b) => a.presetOrder! - b.presetOrder!);
  // Форма на самой странице: при уходе с введёнными данными — обычный вопрос о сохранении.
  const { ref, markClean } = useFormGuard(true, undefined, state);
  const toast = useToast();
  // Новая форма после успеха даёт пустые поля; при ошибке сервера введённое остаётся.
  const [formKey, setFormKey] = useState(0);
  const leavingPage = useRef(false);
  useActionSuccess(state, () => {
    setFormKey((key) => key + 1);
    setRoleId(defaultRoleId);
    setDepartmentId("");
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
      {presets.length > 0 ? (
        <div>
          <p className="mb-1.5 text-sm font-medium">Быстрый выбор роли</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Шаблоны ролей">
            {presets.map((role) => (
              <button
                key={role.id}
                type="button"
                aria-pressed={role.id === roleId}
                onClick={() => setRoleId(role.id)}
                className={
                  role.id === roleId
                    ? "rounded-full border border-[var(--accent)] bg-[var(--accent)] px-2.5 py-1 text-xs text-[var(--accent-fg)]"
                    : "rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-xs hover:border-[var(--accent)]"
                }
              >
                {role.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div>
        <Label htmlFor="roleId">{t("inviteRole")}</Label>
        <Select
          id="roleId"
          name="roleId"
          value={roleId}
          onChange={(event) => setRoleId(event.target.value)}
          required
        >
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </Select>
        {selectedRole?.note ? (
          <p className="mt-1 text-xs text-[var(--muted-fg)]" data-testid="invite-role-note">
            {selectedRole.note}
          </p>
        ) : null}
      </div>
      <div>
        <Label htmlFor="departmentId">Глава цеха (смета своего цеха)</Label>
        {departments.length > 0 ? (
          <Select
            id="departmentId"
            name="departmentId"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">— не назначать —</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
        ) : (
          <p className="text-xs text-[var(--muted-fg)]">
            Цехов пока нет — их создают в{" "}
            <Link
              href={`/${locale}/projects/${projectId}/settings/departments`}
              className="text-[var(--accent)] hover:underline"
            >
              «Настройки → Цеха»
            </Link>
            .
          </p>
        )}
        {selectedRole?.departmentHead && !departmentId && departments.length > 0 ? (
          <p className="mt-1 text-xs text-[var(--tone-warning-strong)]" data-testid="invite-department-hint">
            Эта роль правит смету своего цеха — выберите цех, иначе смета будет недоступна.
          </p>
        ) : null}
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
