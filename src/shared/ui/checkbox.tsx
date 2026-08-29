"use client";

import { type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export function Checkbox({
  className,
  label,
  children,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
}) {
  const text = label ?? children;

  return (
    <label
      className={cn(
        "group inline-flex cursor-pointer items-center gap-2.5 text-sm text-[var(--foreground)]",
        props.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <span className="relative inline-flex h-[1.125rem] w-[1.125rem] shrink-0">
        <input type="checkbox" className="peer sr-only" {...props} />
        <span
          className={cn(
            "glass-checkbox absolute inset-0 rounded-[0.3rem] border border-[var(--border-strong)]",
            "bg-white/5 transition-all duration-150",
            "peer-focus-visible:border-[var(--accent)] peer-focus-visible:shadow-[0_0_0_3px_rgba(110,168,255,0.15)]",
            "peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)]/25",
            "group-hover:border-[var(--border-strong)] group-hover:bg-white/8",
          )}
          aria-hidden
        />
        <svg
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 m-auto h-2.5 w-2.5 text-[var(--accent-fg)]",
            "scale-75 opacity-0 transition-all duration-150",
            "peer-checked:scale-100 peer-checked:opacity-100",
          )}
        >
          <path
            d="M2.5 6l2.2 2.2L9.5 3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {text ? <span>{text}</span> : null}
    </label>
  );
}
