"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/shared/ui/modal";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

type Props = {
  open: boolean;
  pending: boolean;
  error?: string | null;
  onClose: () => void;
  onSaveSame: () => void;
  onSaveNew: (title: string) => void;
};

export function ScreenplaySaveModal({
  open,
  pending,
  error,
  onClose,
  onSaveSame,
  onSaveNew,
}: Props) {
  const [newTitle, setNewTitle] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNewTitle("");
      setLocalError(null);
    }
  }, [open]);

  useEffect(() => {
    if (error) setLocalError(error);
  }, [error]);

  function submitNewVersion() {
    const trimmed = newTitle.trim();
    if (!trimmed) {
      setLocalError("Введите название новой версии");
      return;
    }
    setLocalError(null);
    onSaveNew(trimmed);
  }

  return (
    <Modal open={open} onClose={onClose} title="Сохранить изменения">
      <p className="mb-4 text-sm text-[var(--muted-fg)]">
        Выберите, как сохранить правки. Обновление либретто — отдельно («Обновить в
        либретто»).
      </p>
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={onSaveSame}
        >
          Сохранить в эту же версию
        </Button>
        <div className="rounded-lg border border-[var(--border)] p-3">
          <Label htmlFor="new-version-title" className="mb-2 block text-xs">
            Название новой версии
          </Label>
          <Input
            id="new-version-title"
            value={newTitle}
            required
            placeholder="Например: Черновик 2"
            className="mb-3"
            disabled={pending}
            onChange={(event) => {
              setNewTitle(event.target.value);
              setLocalError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitNewVersion();
              }
            }}
          />
          <Button type="button" disabled={pending} onClick={submitNewVersion}>
            Сохранить как новую версию
          </Button>
        </div>
        {localError ? (
          <p className="text-sm text-[var(--danger)]">{localError}</p>
        ) : null}
      </div>
    </Modal>
  );
}
