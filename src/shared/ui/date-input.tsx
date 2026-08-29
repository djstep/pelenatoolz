"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import { cn } from "@/shared/lib/cn";

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function toIso(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplay(iso: string) {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${d}.${m}.${y}`;
}

function parseIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function buildCalendarDays(view: Date) {
  const first = startOfMonth(view);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startOffset);

  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    return day;
  });
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="2"
        y="3"
        width="12"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path d="M2 6.5h12M5.5 1.5v2M10.5 1.5v2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

export function DateInput({
  className,
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  placeholder = "Выберите дату",
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(() =>
    defaultValue != null ? String(defaultValue) : "",
  );
  const [open, setOpen] = useState(false);

  const current = isControlled
    ? value == null
      ? ""
      : String(value)
    : internal;

  const selectedDate = current ? parseIso(current) : null;
  const [viewMonth, setViewMonth] = useState(() =>
    startOfMonth(selectedDate ?? new Date()),
  );

  useEffect(() => {
    if (selectedDate) {
      setViewMonth(startOfMonth(selectedDate));
    }
  }, [current]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function commit(next: string) {
    if (!isControlled) setInternal(next);
    onChange?.({
      target: { value: next, name: name ?? "", type: "date" },
      currentTarget: { value: next, name: name ?? "", type: "date" },
    } as ChangeEvent<HTMLInputElement>);
    setOpen(false);
  }

  const days = buildCalendarDays(viewMonth);
  const todayIso = toIso(new Date());

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <input
        type="hidden"
        name={name}
        value={current}
        required={required}
        disabled={disabled}
      />

      <button
        type="button"
        id={inputId}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "glass-input glass-select-trigger w-full rounded-xl px-3 py-2.5 text-sm",
          disabled && "cursor-not-allowed opacity-60",
        )}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span className={cn("truncate", !current && "text-[var(--muted)]")}>
          {current ? formatDisplay(current) : placeholder}
        </span>
        <CalendarIcon />
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Выбор даты"
          className="glass-dropdown absolute z-50 mt-1.5 w-[17.5rem] p-3"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              className="glass-number-btn !w-8 !rounded-lg"
              aria-label="Предыдущий месяц"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
            >
              ‹
            </button>
            <div className="text-sm font-medium">
              {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </div>
            <button
              type="button"
              className="glass-number-btn !w-8 !rounded-lg"
              aria-label="Следующий месяц"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="py-1 text-center text-[0.65rem] font-medium uppercase tracking-wide text-[var(--muted)]"
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const iso = toIso(day);
              const inMonth = day.getMonth() === viewMonth.getMonth();
              const isSelected = current === iso;
              const isToday = todayIso === iso;

              return (
                <button
                  key={iso}
                  type="button"
                  data-selected={isSelected ? "true" : undefined}
                  className={cn(
                    "glass-dropdown-item !justify-center !px-0 !py-1.5 text-xs",
                    !inMonth && "opacity-35",
                    isToday && !isSelected && "text-[var(--accent)]",
                  )}
                  onClick={() => commit(iso)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex gap-2 border-t border-[var(--border)] pt-2">
            <button
              type="button"
              className="glass-dropdown-item flex-1 !justify-center text-xs text-[var(--muted-fg)]"
              onClick={() => commit("")}
            >
              Очистить
            </button>
            <button
              type="button"
              className="glass-dropdown-item flex-1 !justify-center text-xs text-[var(--accent)]"
              onClick={() => commit(todayIso)}
            >
              Сегодня
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
