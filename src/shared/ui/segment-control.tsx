"use client";

import { cn } from "@/shared/lib/cn";

export function SegmentControl<T extends string>({
  name,
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    // Сегменты: подложка --background, выбранный — --surface с рамкой.
    <div
      className={cn(
        "inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] p-1",
        className,
      )}
    >
      <input type="hidden" name={name} value={value} />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            className={cn(
              "rounded-md border px-3 py-[5px] text-sm leading-5 transition-colors duration-150",
              selected
                ? "border-[var(--border)] bg-[var(--surface)] font-semibold text-[var(--foreground)] shadow-[var(--glass-shadow)]"
                : "border-transparent text-[var(--muted-fg)] hover:text-[var(--foreground)]",
              disabled && "cursor-not-allowed opacity-60",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
