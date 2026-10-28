"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { snapshotFields } from "@/shared/ui/unsaved/snapshot";
import { useUnsavedChanges } from "@/shared/ui/unsaved/unsaved-changes-provider";

/** Через сколько после открытия запоминать исходные значения: формы успевают их подставить. */
const BASELINE_DELAY_MS = 150;

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  guardUnsaved = false,
  baselineKey,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /**
   * Спрашивать при закрытии, если значения полей отличаются от исходных:
   * крестик, Esc, клик мимо и кнопки с атрибутом data-modal-cancel («Отмена»).
   * Успешное сохранение закрывает окно напрямую через onClose — без вопроса.
   */
  guardUnsaved?: boolean;
  /** Сменился — исходные значения запоминаются заново (например, форма очищена после «Создать ещё»). */
  baselineKey?: string | number;
}) {
  const unsaved = useUnsavedChanges();
  const dialogRef = useRef<HTMLDivElement>(null);
  const baseline = useRef<string | null>(null);

  const isDirty = useCallback(() => {
    const el = dialogRef.current;
    if (!guardUnsaved || !el || baseline.current === null) return false;
    return snapshotFields(el) !== baseline.current;
  }, [guardUnsaved]);

  useEffect(() => {
    if (!open || !guardUnsaved) return;
    baseline.current = null;
    const timer = window.setTimeout(() => {
      if (dialogRef.current) baseline.current = snapshotFields(dialogRef.current);
    }, BASELINE_DELAY_MS);
    const unregister = unsaved.register(isDirty);
    return () => {
      window.clearTimeout(timer);
      unregister();
      baseline.current = null;
    };
  }, [open, guardUnsaved, unsaved, isDirty, baselineKey]);

  const requestClose = useCallback(() => {
    if (unsaved.isPrompting()) return;
    if (!isDirty()) {
      onClose();
      return;
    }
    // «Сохранить» в вопросе — та же кнопка сохранения окна; при ошибке окно остаётся.
    const submit = dialogRef.current?.querySelector<HTMLButtonElement>(
      'button[type="submit"]:not([disabled])',
    );
    void unsaved.confirm({ canSave: Boolean(submit) }).then((choice) => {
      if (choice === "discard") onClose();
      else if (choice === "save") submit?.click();
    });
  }, [isDirty, onClose, unsaved]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Окно поверх окна (подтверждение удаления) — Esc закрывает только верхнее.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      requestClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, requestClose]);

  // «Отмена» в окне обычно вызывает onClose родителя напрямую — перехватываем её.
  const onClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const cancel = (event.target as Element).closest("[data-modal-cancel]");
      if (!cancel || !isDirty()) return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    },
    [isDirty, requestClose],
  );

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        aria-label="Закрыть"
        onClick={requestClose}
      />
      <div
        ref={dialogRef}
        className={cn(
          "relative flex max-h-[92vh] w-full flex-col glass-card shadow-2xl",
          wide ? "max-w-4xl" : "max-w-2xl",
        )}
        role="dialog"
        aria-modal="true"
        onClickCapture={guardUnsaved ? onClickCapture : undefined}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <Button type="button" variant="ghost" onClick={requestClose} aria-label="Закрыть">
            ×
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="border-t border-[var(--border)] px-5 py-4">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
