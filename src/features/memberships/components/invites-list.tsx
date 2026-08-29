"use client";

import { useTranslations } from "next-intl";
import { revokeInviteAction } from "@/features/projects/actions";
import { Button } from "@/shared/ui/button";

type InviteRow = {
  id: string;
  token: string;
  email: string | null;
  role: { name: string };
  expiresAt: Date;
};

export function InvitesList({
  projectId,
  invites,
  appUrl,
}: {
  projectId: string;
  invites: InviteRow[];
  appUrl: string;
}) {
  const t = useTranslations("members");

  if (invites.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-fg)]">
        {t("activeInvites")}
      </h3>
      <ul className="space-y-2">
        {invites.map((invite) => {
          const url = `${appUrl}/ru/invite/${invite.token}`;
          return (
            <li
              key={invite.id}
              className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="text-sm">
                <p className="font-medium">
                  {invite.email ?? "Открытая ссылка"} · {invite.role.name}
                </p>
                <p className="break-all text-[var(--muted-fg)]">{url}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigator.clipboard.writeText(url)}
                >
                  {t("copyLink")}
                </Button>
                <form
                  action={async () => {
                    await revokeInviteAction(invite.id, projectId);
                  }}
                >
                  <Button type="submit" variant="danger">
                    {t("revoke")}
                  </Button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
