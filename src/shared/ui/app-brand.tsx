import { APP_BRAND } from "@/shared/brand";
import { cn } from "@/shared/lib/cn";

export function AppBrand({
  className,
  size = "md",
}: {
  className?: string;
  size?: "md" | "lg";
}) {
  return (
    <span
      className={cn(
        "inline-block font-body font-semibold leading-none tracking-[0.04em] text-[var(--foreground)]",
        size === "lg" ? "text-3xl" : "text-lg",
        className,
      )}
    >
      {APP_BRAND}
    </span>
  );
}
