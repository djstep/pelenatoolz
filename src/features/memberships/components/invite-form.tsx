"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  createInviteAction,
  type ActionState,
} from "@/features/projects/actions";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";

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
  const [state, action, pending] = useActionState(bound, initial);
  const [copied, setCopied] = useState(false);
  const defaultRoleId = roles.find((r) => r.name === "Наблюдатель")?.id ?? roles[0]?.id;

  useEffect(() => {
    setCopied(false);
  }, [state.inviteUrl]);

  async function copyLink() {
    if (!state.inviteUrl) return;
    await navigator.clipboard.writeText(state.inviteUrl);
    setCopied(true);
  }

  return (
    <form action={action} className="space-y-4">
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
