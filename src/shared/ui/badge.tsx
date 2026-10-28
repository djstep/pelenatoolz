import { type CSSProperties, type HTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

export function Badge({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "glass-badge inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium tracking-wide",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Бейдж со своим цветом (статусы согласования): вместе с className="status-badge".
 * Цвета задаёт globals.css — в светлой теме текст затемняется ради контраста.
 */
export function statusBadgeStyle(color: string): CSSProperties {
  return { "--status-color": color } as CSSProperties;
}
