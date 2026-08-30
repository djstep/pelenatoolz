"use client";

import { type InputHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";
import { DateInput } from "@/shared/ui/date-input";
import { NumberInput } from "@/shared/ui/number-input";

export function Input({
  className,
  type,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  if (type === "number") {
    return <NumberInput className={className} {...props} />;
  }

  if (type === "date") {
    return <DateInput className={className} {...props} />;
  }

  return (
    <input
      type={type}
      className={cn(
        "glass-input w-full rounded-xl px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]",
        className,
      )}
      {...props}
    />
  );
}
