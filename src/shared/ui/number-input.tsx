"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
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

function stepDecimals(step: number) {
  if (!Number.isFinite(step) || step <= 0 || Number.isInteger(step)) return 0;
  const [, fraction = ""] = step.toString().split(".");
  return fraction.length;
}

function roundToStep(value: number, step: number) {
  if (!Number.isFinite(step) || step <= 0) return value;
  const decimals = stepDecimals(step);
  const rounded = Math.round(value / step) * step;
  return Number(rounded.toFixed(decimals));
}

function formatNumberValue(value: number, step: number) {
  return roundToStep(value, step).toFixed(stepDecimals(step));
}

const HOLD_DELAY_MS = 400;
const HOLD_INTERVAL_MS = 75;

type RepeatState = {
  timeoutId?: ReturnType<typeof setTimeout>;
  intervalId?: ReturnType<typeof setInterval>;
  stopWindowListeners?: () => void;
};

function clearRepeat(state: RepeatState) {
  if (state.timeoutId != null) clearTimeout(state.timeoutId);
  if (state.intervalId != null) clearInterval(state.intervalId);
  state.stopWindowListeners?.();
  state.timeoutId = undefined;
  state.intervalId = undefined;
  state.stopWindowListeners = undefined;
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
    return initial == null ? "" : formatNumberValue(initial, stepN);
  });

  const display = isControlled
    ? value === "" || value == null
      ? ""
      : String(value)
    : internal;

  const valueRef = useRef(display);
  valueRef.current = display;

  const current = toNumber(display);
  const repeatRef = useRef<RepeatState>({});

  useEffect(() => () => clearRepeat(repeatRef.current), []);

  function emit(text: string) {
    valueRef.current = text;
    if (!isControlled) setInternal(text);
    if (!onChange) return;
    const synthetic = {
      target: { value: text, name: name ?? "", type: "number" },
      currentTarget: { value: text, name: name ?? "", type: "number" },
    } as unknown as ChangeEvent<HTMLInputElement>;
    onChange(synthetic);
  }

  function bump(direction: 1 | -1): boolean {
    if (disabled) return false;
    const base = toNumber(valueRef.current) ?? minN ?? 0;
    const unclamped = base + direction * stepN;
    const next = roundToStep(clamp(unclamped, minN, maxN), stepN);
    const formatted = formatNumberValue(next, stepN);
    if (formatted === formatNumberValue(base, stepN) && unclamped !== next) {
      return false;
    }
    emit(formatted);
    return true;
  }

  function stopRepeat() {
    clearRepeat(repeatRef.current);
  }

  function startRepeat(direction: 1 | -1) {
    stopRepeat();

    const tick = () => {
      if (!bump(direction)) stopRepeat();
    };

    tick();

    const onWindowPointerEnd = () => stopRepeat();
    window.addEventListener("pointerup", onWindowPointerEnd);
    window.addEventListener("pointercancel", onWindowPointerEnd);
    repeatRef.current.stopWindowListeners = () => {
      window.removeEventListener("pointerup", onWindowPointerEnd);
      window.removeEventListener("pointercancel", onWindowPointerEnd);
    };

    repeatRef.current.timeoutId = setTimeout(() => {
      repeatRef.current.intervalId = setInterval(tick, HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  }

  function handleStepPointerDown(
    event: PointerEvent<HTMLButtonElement>,
    direction: 1 | -1,
    blocked: boolean,
  ) {
    if (blocked || event.button !== 0) return;
    event.preventDefault();
    startRepeat(direction);
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
        onPointerDown={(event) => handleStepPointerDown(event, -1, disabled || atMin)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
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
              const next = roundToStep(clamp(n, minN, maxN), stepN);
              const formatted = formatNumberValue(next, stepN);
              if (formatted !== raw) emit(formatted);
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
        onPointerDown={(event) => handleStepPointerDown(event, 1, disabled || atMax)}
        onPointerUp={stopRepeat}
        onPointerLeave={stopRepeat}
        onPointerCancel={stopRepeat}
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
