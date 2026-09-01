"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
import { cn } from "@/shared/lib/cn";

const HH_MM_PATTERN = /^\d{1,3}:\d{2}$/;

/** Up to 4 digits from any input (10 20, 10:20, 1020 → 1020). */
export function extractTimeDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 4);
}

function formatFromDigitStream(digits: string): string {
  if (!digits) return ":";

  if (digits.length <= 2) {
    return `${digits}:`;
  }

  if (digits.length === 3) {
    const hh = Number(digits.slice(0, 2));
    // 820 → 08:2, 102 → 10:2
    if (hh > 23) {
      return `0${digits[0]}:${digits.slice(1)}`;
    }
    return `${digits.slice(0, 2)}:${digits[2]}`;
  }

  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

function parseFromDigitStream(
  digits: string,
  finalize = false,
): number | undefined {
  if (!digits) return undefined;

  if (digits.length <= 2) {
    const h = Number(digits);
    if (Number.isNaN(h) || h > 23) return undefined;
    return h * 60;
  }

  if (digits.length === 3) {
    const hh = Number(digits.slice(0, 2));
    if (hh > 23) {
      const h = Number(digits[0]);
      const m = Number(digits.slice(1).padEnd(2, "0"));
      if (Number.isNaN(h) || Number.isNaN(m) || m >= 60) return undefined;
      return finalize ? h * 60 + m : undefined;
    }
    const h = hh;
    const m = Number(digits[2]!.padEnd(2, "0"));
    if (Number.isNaN(m) || m >= 60) return undefined;
    return finalize ? h * 60 + m : undefined;
  }

  const h = Number(digits.slice(0, 2));
  const m = Number(digits.slice(2, 4));
  if (Number.isNaN(h) || Number.isNaN(m) || h > 23 || m >= 60) return undefined;
  return h * 60 + m;
}

function parseTimeInputValue(raw: string, finalize = false): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === ":") return undefined;
  return parseFromDigitStream(extractTimeDigits(trimmed), finalize);
}

function digitsToFormattedValue(digits: string): string | null {
  if (!digits) return null;
  const mins = parseFromDigitStream(digits, true);
  if (mins == null) return null;
  return formatMinutesHhMm(mins);
}

/** Live formatting — always from digit stream, colon is display-only. */
function formatTimeInput(raw: string): string {
  if (!raw || raw === ":") return ":";
  return formatFromDigitStream(extractTimeDigits(raw));
}

function isEmptyDigits(digits: string): boolean {
  return !digits || /^0+$/.test(digits);
}

export function isValidHhMm(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return parseTimeInputValue(trimmed, true) != null;
}

export function normalizeHhMm(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const formatted = digitsToFormattedValue(extractTimeDigits(trimmed));
  if (formatted == null) return trimmed;
  return formatted;
}

/** @deprecated use parseTimeInputValue — kept for callers using digit-only compact parse */
export function parseTimeInputDigits(digits: string): number | undefined {
  return parseFromDigitStream(digits, true);
}

export function HhMmInput({
  value,
  onChange,
  className,
  placeholder = "00:00",
  disabled,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const digitsRef = useRef("");
  const replaceOnNextKeyRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() =>
    value ? formatTimeInput(value) : "",
  );
  const [invalid, setInvalid] = useState(false);

  function isFullSelection(el: HTMLInputElement | null): boolean {
    if (!el) return false;
    return el.selectionStart === 0 && el.selectionEnd === el.value.length;
  }

  function syncDraftFromDigits() {
    const digits = digitsRef.current;
    setDraft(isEmptyDigits(digits) ? ":" : formatFromDigitStream(digits));
    setInvalid(false);
  }

  function moveCaretToEnd() {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      const pos = el.value.length;
      el.setSelectionRange(pos, pos);
    });
  }

  useEffect(() => {
    if (focused) return;
    const digits = extractTimeDigits(value);
    digitsRef.current = digits;
    setDraft(value ? formatTimeInput(value) : "");
    setInvalid(false);
  }, [value, focused]);

  function commit() {
    const digits = digitsRef.current;
    if (isEmptyDigits(digits)) {
      digitsRef.current = "";
      setDraft("");
      onChange("");
      setInvalid(false);
      return;
    }

    const formatted = digitsToFormattedValue(digits);
    if (formatted == null) {
      setInvalid(true);
      return;
    }

    digitsRef.current = extractTimeDigits(formatted);
    setDraft(formatted);
    onChange(formatted);
    setInvalid(false);
  }

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      placeholder={placeholder}
      value={draft}
      onFocus={() => {
        setFocused(true);
        const digits = extractTimeDigits(value || draft);
        if (isEmptyDigits(digits)) {
          digitsRef.current = "";
          setDraft(":");
        } else {
          digitsRef.current = digits;
          setDraft(formatFromDigitStream(digits));
        }
        setInvalid(false);
        replaceOnNextKeyRef.current = !isEmptyDigits(digits);
        requestAnimationFrame(() => inputRef.current?.select());
      }}
      onMouseDown={(e) => {
        const input = e.currentTarget;
        if (document.activeElement === input) {
          e.preventDefault();
          input.select();
          replaceOnNextKeyRef.current = !isEmptyDigits(digitsRef.current);
        }
      }}
      onChange={(e) => {
        const digits = extractTimeDigits(e.target.value);
        if (digits !== digitsRef.current) {
          digitsRef.current = digits;
          syncDraftFromDigits();
          moveCaretToEnd();
        }
      }}
      onBlur={() => {
        setFocused(false);
        replaceOnNextKeyRef.current = false;
        if (draft === ":" || isEmptyDigits(digitsRef.current)) {
          digitsRef.current = "";
          setDraft("");
          onChange("");
          setInvalid(false);
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (disabled) return;

        if (e.key >= "0" && e.key <= "9") {
          e.preventDefault();
          const el = inputRef.current;
          const shouldReplace =
            replaceOnNextKeyRef.current ||
            isFullSelection(el) ||
            digitsRef.current.length >= 4;
          replaceOnNextKeyRef.current = false;
          if (shouldReplace) {
            digitsRef.current = e.key;
          } else {
            digitsRef.current += e.key;
          }
          syncDraftFromDigits();
          moveCaretToEnd();
          return;
        }

        if (e.key === "Backspace") {
          e.preventDefault();
          replaceOnNextKeyRef.current = false;
          if (isFullSelection(inputRef.current)) {
            digitsRef.current = "";
            setDraft(":");
            setInvalid(false);
          } else {
            digitsRef.current = digitsRef.current.slice(0, -1);
            syncDraftFromDigits();
          }
          moveCaretToEnd();
          return;
        }

        if (e.key === "Delete") {
          e.preventDefault();
          replaceOnNextKeyRef.current = false;
          digitsRef.current = "";
          setDraft(":");
          setInvalid(false);
          moveCaretToEnd();
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          inputRef.current?.blur();
        }
      }}
      className={cn(
        "glass-input w-full rounded-xl px-3 py-2 font-mono text-sm tracking-wider text-[var(--foreground)] placeholder:text-[var(--muted)]",
        invalid && "border-[var(--danger)] ring-1 ring-[var(--danger)]/50",
        className,
      )}
      aria-invalid={invalid}
      title={invalid ? "Формат: ЧЧ:ММ (например 10:20 или 1020)" : undefined}
    />
  );
}

export function hhMmToMinutes(value: string): number {
  return parseTimeInputValue(value.trim(), true) ?? 0;
}

export { HH_MM_PATTERN };
