import { type HTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

/** Номер сцены, стоящий отдельно, — «хлопушка»: рамка, фон --surface-2, жирный. */
export function SceneNumber({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] min-w-[26px] shrink-0 items-center justify-center rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-2)] px-1 text-xs font-bold tabular-nums text-[var(--foreground)]",
        className,
      )}
      {...props}
    />
  );
}
