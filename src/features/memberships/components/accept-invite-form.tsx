"use client";

import { useActionState } from "react";
import { acceptInviteAction, type ActionState } from "@/features/projects/actions";
import { Button } from "@/shared/ui/button";

const initial: ActionState = {};

/** Кнопка принятия приглашения. При успехе сервер сам переводит в проект, при отказе показываем причину. */
export function AcceptInviteForm({
  token,
  label,
}: {
  token: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(
    async (): Promise<ActionState> => acceptInviteAction(token),
    initial,
  );

  return (
    <form action={action} className="space-y-3">
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "…" : label}
      </Button>
      {state.error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
