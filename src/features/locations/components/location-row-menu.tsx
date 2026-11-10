"use client";

import { useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { PortaledMenu } from "@/shared/ui/portaled-menu";

export type LocationRowMenuItem = { label: string; onSelect: () => void; danger?: boolean };

/** Действия строки объекта в одной кнопке «⋯»: таблица помещается в ширину экрана. */
export function LocationRowMenu({ title, items }: { title: string; items: LocationRowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        <Button
          type="button"
          variant="ghost"
          className="px-2"
          aria-label={`Действия: ${title}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          ⋯
        </Button>
      </span>
      <PortaledMenu
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        role="menu"
        align="end"
        minWidth={176}
        className="py-1"
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={cn(
              "glass-dropdown-item block w-full px-3 py-2 text-left text-sm",
              item.danger && "text-[var(--danger)]",
            )}
            onClick={() => {
              setOpen(false);
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </PortaledMenu>
    </>
  );
}
