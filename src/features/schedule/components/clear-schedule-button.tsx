"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clearScheduleCalendarAction } from "@/features/schedule/actions";
import { Button } from "@/shared/ui/button";

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

  if (!canWrite || dayCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="danger"
        disabled={pending}
        onClick={() => {
          const lines = [
            `Удалить все съёмочные дни (${dayCount})?`,
            assignedCount > 0
              ? `${assignedCount} сцен вернутся в неспланированные.`
              : "Сцены на календаре не назначены.",
            "Это действие нельзя отменить.",
          ];
          if (!confirm(lines.join("\n\n"))) return;

          setMessage(null);
          startTransition(async () => {
            const result = await clearScheduleCalendarAction(projectId);
            if (result.error) {
              setMessage(result.error);
              return;
            }
            setMessage(result.success ?? "Календарь очищен");
            router.refresh();
          });
        }}
      >
        {pending ? "Очистка…" : "Очистить календарь"}
      </Button>
      {message ? (
        <span
          className={
            message.includes("Недостаточно") || message.includes("ошиб")
              ? "text-sm text-[var(--danger)]"
              : "text-sm text-emerald-300"
          }
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
