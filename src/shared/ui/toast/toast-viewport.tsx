"use client";

import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";
import type { ToastRecord, ToastType } from "@/shared/ui/toast/types";

const TYPE_STYLES: Record<
  ToastType,
  { border: string; icon: string; label: string }
> = {
  success: {
    border: "border-l-emerald-400/80",
    icon: "text-emerald-400",
    label: "Успешно",
  },
  error: {
    border: "border-l-[var(--danger)]",
    icon: "text-[var(--danger)]",
    label: "Ошибка",
  },
  info: {
    border: "border-l-[var(--accent)]",
    icon: "text-[var(--accent)]",
    label: "Информация",
  },
  warning: {
    border: "border-l-amber-400",
    icon: "text-amber-400",
    label: "Внимание",
  },
};

function ToastIcon({ type }: { type: ToastType }) {
  const className = cn("h-5 w-5 shrink-0", TYPE_STYLES[type].icon);

  if (type === "success") {
    return (
      <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M6.5 10.2 8.7 12.4 13.5 7.6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }

  if (type === "error") {
    return (
      <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M10 6.8v4.2M10 13.4h.01"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (type === "warning") {
    return (
      <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M10 4.2 16.2 15H3.8L10 4.2Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path
          d="M10 8.4v3.4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="10" cy="13.8" r="0.9" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10 9v4.2M10 6.6h.01"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastRecord;
  onDismiss: (id: string) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const style = TYPE_STYLES[item.type];

  useEffect(() => {
    if (item.duration <= 0) return;
    const hideTimer = window.setTimeout(() => setLeaving(true), item.duration - 220);
    const removeTimer = window.setTimeout(() => onDismiss(item.id), item.duration);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(removeTimer);
    };
  }, [item.duration, item.id, onDismiss]);

  return (
    <div
      role={item.type === "error" ? "alert" : "status"}
      aria-live={item.type === "error" ? "assertive" : "polite"}
      className={cn(
        "toast-item glass-card border border-[var(--border)] border-l-4 p-3 shadow-2xl",
        style.border,
        leaving && "toast-item--leaving",
      )}
    >
      <div className="flex items-start gap-3">
        <ToastIcon type={item.type} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-fg)]">
            {item.title ?? style.label}
          </p>
          <p className="mt-0.5 text-sm leading-snug text-[var(--foreground)]">
            {item.message}
          </p>
        </div>
        <button
          type="button"
          className="toast-close"
          aria-label="Закрыть уведомление"
          onClick={() => {
            setLeaving(true);
            window.setTimeout(() => onDismiss(item.id), 180);
          }}
        >
          ×
        </button>
      </div>
      {item.duration > 0 ? (
        <div className="toast-progress-track mt-3">
          <div
            className="toast-progress-bar"
            style={{ animationDuration: `${item.duration}ms` }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="toast-viewport" aria-label="Уведомления">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
