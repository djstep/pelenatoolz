"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveShootDayToDateAction } from "@/features/schedule/actions";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Modal } from "@/shared/ui/modal";
import { useActionToast } from "@/shared/ui/toast";

export function CallSheetMoveDateModal({
  open,
  onClose,
  projectId,
  dayId,
  dayNumber,
  currentDate,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  dayId: string;
  dayNumber: number;
  currentDate: Date;
  locale: string;
}) {
  const router = useRouter();
  const [dateValue, setDateValue] = useState(
    () => new Date(currentDate).toISOString().slice(0, 10),
  );
  const [message, setMessage] = useState<{ error?: string; success?: string }>(
    {},
  );
  const [pending, startTransition] = useTransition();

  useActionToast(message);

  function handleSubmit() {
    startTransition(async () => {
      const result = await moveShootDayToDateAction(projectId, dayId, dateValue);
      setMessage(result);
      if (result.error) return;
      onClose();
      router.refresh();
      if (result.redirectDayId && result.redirectDayId !== dayId) {
        router.push(
          `/${locale}/projects/${projectId}/call-sheets/${result.redirectDayId}`,
        );
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Перенести день ${dayNumber}`}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="button" disabled={pending || !dateValue} onClick={handleSubmit}>
            {pending ? "Перенос…" : "Перенести"}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-[var(--muted-fg)]">
        Укажите новую дату. Если на ней уже есть другой съёмочный день, даты
        поменяются местами.
      </p>
      <Input
        type="date"
        value={dateValue}
        onChange={(e) => setDateValue(e.target.value)}
      />
    </Modal>
  );
}
