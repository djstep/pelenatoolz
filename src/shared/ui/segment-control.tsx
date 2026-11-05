"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { cn } from "@/shared/lib/cn";

// Сегменты: подложка --background, выбранный — --surface с рамкой.
const SEGMENT_TRACK =
  "max-w-full gap-1 rounded-lg border border-[var(--border)] bg-[var(--background)] p-1";

function segmentClass(selected: boolean) {
  return cn(
    "rounded-md border px-3 py-[5px] text-sm leading-5 transition-colors duration-150",
    selected
      ? "border-[var(--border)] bg-[var(--surface)] font-semibold text-[var(--foreground)] shadow-[var(--glass-shadow)]"
      : "border-transparent text-[var(--muted-fg)] hover:text-[var(--foreground)]",
  );
}

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
    <div className={cn("inline-flex flex-wrap", SEGMENT_TRACK, className)}>
      <input type="hidden" name={name} value={value} />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            className={cn(segmentClass(selected), disabled && "cursor-not-allowed opacity-60")}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Те же сегменты, но ссылками: каждая ведёт на свою страницу. Всегда в одну строку: что не
 * поместилось, прокручивается внутри полосы, выбранная ссылка держится в видимой области.
 */
export function SegmentLinks({
  label,
  items,
  activeHref,
  className,
}: {
  /** Название полосы для чтения с экрана. */
  label: string;
  /** `count` — приглушённый счётчик внутри ссылки, `countLabel` — что он значит. */
  items: { href: string; label: string; count?: number; countLabel?: string }[];
  /** Адрес выбранной ссылки; `null` — ни одна не выбрана. */
  activeHref: string | null;
  className?: string;
}) {
  const trackRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    const active = track?.querySelector('[aria-current="page"]');
    if (!track || !active) return;
    // Не scrollIntoView: он сдвинул бы и страницу, а нужна только полоса.
    const bounds = track.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.left < bounds.left) track.scrollLeft -= bounds.left - box.left;
    else if (box.right > bounds.right) track.scrollLeft += box.right - bounds.right;
  }, [activeHref]);

  return (
    <nav
      ref={trackRef}
      aria-label={label}
      className={cn("inline-flex self-start overflow-x-auto", SEGMENT_TRACK, className)}
    >
      {items.map((item) => {
        const selected = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={selected ? "page" : undefined}
            className={cn("shrink-0 whitespace-nowrap", segmentClass(selected))}
          >
            {item.label}
            {/* Пробел нужен для чтения с экрана: иначе подпись и счётчик сливаются в одно слово. */}
            {item.count ? " " : null}
            {item.count ? (
              <span
                className="ml-0.5 font-normal text-[var(--muted-fg)] tabular-nums"
                title={item.countLabel}
                aria-label={`${item.countLabel}: ${item.count}`}
              >
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
