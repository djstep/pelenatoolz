import { type HTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("glass-card p-5 transition-all duration-300", className)}
      {...props}
    />
  );
}
