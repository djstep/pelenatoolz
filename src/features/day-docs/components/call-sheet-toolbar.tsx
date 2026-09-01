"use client";

import { useState, useTransition } from "react";
import {
  toggleCallSheetPlanLockAction,
  type CallSheetActionState,
} from "@/features/day-docs/actions";
import { CallSheetRecalculateModal } from "@/features/day-docs/components/call-sheet-recalculate-modal";
import { Button } from "@/shared/ui/button";
import { useActionToast } from "@/shared/ui/toast";

export function CallSheetToolbar({
  projectId,
  dayId,
  planLocked,
  savedAt,
  canEdit,
  onInsertTravel,
  travelPending,
}: {
  projectId: string;
  dayId: string;
  planLocked: boolean;
  savedAt: Date | null;
  canEdit: boolean;
  onInsertTravel?: () => void;
  travelPending?: boolean;
}) {
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [message, setMessage] = useState<CallSheetActionState>({});
  const [pending, startTransition] = useTransition();

  useActionToast(message);

  if (!canEdit) return null;

  function toggleLock() {
    startTransition(async () => {
      const result = await toggleCallSheetPlanLockAction(
        projectId,
        dayId,
        !planLocked,
      );
      setMessage(result);
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {onInsertTravel ? (
          <Button
            type="button"
            variant="secondary"
            disabled={planLocked || travelPending}
            onClick={onInsertTravel}
          >
            {travelPending ? "Расчёт…" : "Учесть переезды"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => setRecalcOpen(true)}
        >
          Пересчитать время
        </Button>
        <Button
          type="button"
          variant={planLocked ? "secondary" : "ghost"}
          disabled={pending}
          onClick={toggleLock}
        >
          {planLocked ? "Снять фиксацию" : "Зафиксировать план"}
        </Button>
        {savedAt ? (
          <span className="text-xs text-[var(--muted-fg)]">
            Сохранено{" "}
            {savedAt.toLocaleString("ru-RU", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : (
          <span className="text-xs text-amber-400/90">Черновик</span>
        )}
      </div>

      <CallSheetRecalculateModal
        open={recalcOpen}
        onClose={() => setRecalcOpen(false)}
        projectId={projectId}
        dayId={dayId}
      />
    </>
  );
}
