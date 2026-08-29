"use client";

import {
  useId,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { cn } from "@/shared/lib/cn";

function clamp(value: number, min?: number, max?: number) {
  let next = value;
  if (min != null && !Number.isNaN(min)) next = Math.max(min, next);
  if (max != null && !Number.isNaN(max)) next = Math.min(max, next);
  return next;
}

function toNumber(value: string | number | readonly string[] | undefined) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function NumberInput({
  className,
  id,
  name,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  disabled,
  required,
  placeholder,
  onChange,
  onBlur,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const minN = toNumber(min) ?? undefined;
  const maxN = toNumber(max) ?? undefined;
  const stepN = toNumber(step) ?? 1;

  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(() => {
    const initial = toNumber(defaultValue);
    return initial == null ? "" : String(initial);
  });

  const display = isControlled
    ? value === "" || value == null
      ? ""
      : String(value)
    : internal;

  const current = toNumber(display);

  function emit(text: string) {
    if (!isControlled) setInternal(text);
    if (!onChange) return;
    const synthetic = {
      target: { value: text, name: name ?? "", type: "number" },
      currentTarget: { value: text, name: name ?? "", type: "number" },
    } as unknown as ChangeEvent<HTMLInputElement>;
    onChange(synthetic);
  }

  function bump(direction: 1 | -1) {
    if (disabled) return;
    const base = current ?? minN ?? 0;
    emit(String(clamp(base + direction * stepN, minN, maxN)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      bump(1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      bump(-1);
    }
  }

  const atMin = current != null && minN != null && current <= minN;
  const atMax = current != null && maxN != null && current >= maxN;

  return (
    <div
      className={cn(
        "glass-input glass-number-input flex w-full items-stretch overflow-hidden rounded-xl",
        disabled && "pointer-events-none opacity-60",
        className,
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled || atMin}
        aria-label="Уменьшить"
        className="glass-number-btn"
        onClick={() => bump(-1)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M3 7h8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <input
        {...rest}
        id={inputId}
        name={name}
        type="number"
        inputMode="numeric"
        required={required}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        value={display}
        onChange={(e) => emit(e.target.value)}
        onBlur={(e) => {
          const raw = e.target.value;
          if (raw !== "") {
            const n = Number(raw);
            if (Number.isFinite(n)) {
              const next = clamp(n, minN, maxN);
              if (String(next) !== raw) emit(String(next));
            }
          }
          onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
        className="glass-number-field min-w-0 flex-1 bg-transparent px-2 py-2.5 text-center text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
      />

      <button
        type="button"
        tabIndex={-1}
        disabled={disabled || atMax}
        aria-label="Увеличить"
        className="glass-number-btn"
        onClick={() => bump(1)}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M7 3v8M3 7h8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
