"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";

/**
 * Окно с комментарием для отправки и возврата сметы. Подключено к механизму несохранённых
 * изменений: закрыть с введённым текстом — вопрос. onSubmit возвращает текст ошибки или null.
 */
export function BudgetCommentModal({
  open,
  onClose,
  title,
  description,
  label,
  placeholder,
  required = false,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  submitLabel: string;
  onSubmit: (comment: string) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const comment = String(new FormData(event.currentTarget).get("comment") ?? "").trim();
    if (required && !comment) {
      setError("Комментарий обязателен");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const failure = await onSubmit(comment);
      if (failure) setError(failure);
      else onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      guardUnsaved
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title={title}
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" form="budget-comment-form" disabled={pending}>
            {pending ? "…" : submitLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-modal-cancel
            onClick={() => {
              setError(null);
              onClose();
            }}
          >
            Отмена
          </Button>
        </div>
      }
    >
      <form id="budget-comment-form" onSubmit={handleSubmit} className="space-y-3">
        {description ? <p className="text-sm text-[var(--muted-fg)]">{description}</p> : null}
        <div>
          <Label htmlFor="budget-comment">{label}</Label>
          <textarea
            id="budget-comment"
            name="comment"
            rows={4}
            maxLength={2000}
            required={required}
            className="glass-input w-full resize-y px-3 py-2 text-sm"
            placeholder={placeholder}
          />
        </div>
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </form>
    </Modal>
  );
}
