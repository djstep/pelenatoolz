import { type LabelHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1.5 block text-sm font-medium text-[var(--foreground)]",
        className,
      )}
      {...props}
    />
  );
}
