import Image from "next/image";
import { cn } from "@/shared/lib/cn";

const LOGO_WIDTH = 1024;
const LOGO_HEIGHT = 219;

const sizes = {
  md: { className: "h-14" },
  lg: { className: "h-20" },
} as const;

export function AppBrand({
  className,
  size = "md",
}: {
  className?: string;
  size?: "md" | "lg";
}) {
  const { className: heightClass } = sizes[size];

  return (
    <span
      className={cn("relative inline-flex items-center", className)}
      aria-label="PELENA"
    >
      <Image
        src="/brand/pelena-white.png"
        alt=""
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        priority
        className={cn("brand-logo-on-dark w-auto max-w-none", heightClass)}
      />
      <Image
        src="/brand/pelena-black.png"
        alt=""
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        priority
        className={cn("brand-logo-on-light w-auto max-w-none", heightClass)}
      />
    </span>
  );
}
