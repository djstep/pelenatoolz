"use client";

import { useState } from "react";
import { CallSheetMoveDateModal } from "@/features/day-docs/components/call-sheet-move-date-modal";
import { Button } from "@/shared/ui/button";

export function CallSheetMoveDateButton({
  projectId,
  dayId,
  dayNumber,
  currentDate,
  locale,
  canEdit,
}: {
  projectId: string;
  dayId: string;
  dayNumber: number;
  currentDate: Date;
  locale: string;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Перенести дату
      </Button>
      <CallSheetMoveDateModal
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        dayId={dayId}
        dayNumber={dayNumber}
        currentDate={currentDate}
        locale={locale}
      />
    </>
  );
}
