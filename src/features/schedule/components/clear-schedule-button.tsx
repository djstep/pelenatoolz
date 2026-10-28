"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearScheduleCalendarAction } from "@/features/schedule/actions";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";

export function ClearScheduleButton({
  projectId,
  dayCount,
  assignedCount,
  canWrite,
}: {
  projectId: string;
  dayCount: number;
  assignedCount: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const confirmClear = useConfirm();

  if (!canWrite || dayCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="danger"
        disabled={pending}
        onClick={() =>
          void confirmClear({
            title: `Удалить все съёмочные дни (${dayCount})?`,
            details:
              assignedCount > 0
                ? [`Сцены вернутся в неспланированные: ${assignedCount}`]
                : [],
            action: async () => {
              setMessage(null);
              const result = await clearScheduleCalendarAction(projectId);
              if (result.error) return result.error;
              setMessage(result.success ?? "Календарь очищен");
              startTransition(() => router.refresh());
            },
          })
        }
      >
        {pending ? "Очистка…" : "Очистить календарь"}
      </Button>
      {message ? (
        <span
          className={
            message.includes("Недостаточно") || message.includes("ошиб")
              ? "text-sm text-[var(--danger)]"
              : "text-sm text-[var(--tone-success)]"
          }
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
