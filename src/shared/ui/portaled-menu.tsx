"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";

/**
 * Renders a dropdown in a portal with fixed positioning so it is not clipped
 * by ancestors with overflow-x-auto (which forces overflow-y: auto in CSS).
 */
export function PortaledMenu({
  open,
  anchorRef,
  onClose,
  children,
  className,
  id,
  role = "listbox",
  align = "start",
  minWidth,
  matchAnchorWidth,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  id?: string;
  role?: string;
  align?: "start" | "end";
  minWidth?: number;
  matchAnchorWidth?: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;

    function update() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(minWidth ?? 0, matchAnchorWidth ? r.width : 0);
      const menuH = menuRef.current?.offsetHeight ?? 240;
      const gap = 4;
      const spaceBelow = window.innerHeight - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const openUp = spaceBelow < Math.min(menuH, 240) && spaceAbove > spaceBelow;
      let left = align === "end" ? r.right - Math.max(width, r.width) : r.left;
      left = Math.min(Math.max(8, left), window.innerWidth - Math.max(width, 160) - 8);
      setStyle({
        position: "fixed",
        zIndex: 200,
        left,
        width: width || undefined,
        minWidth: minWidth ?? (matchAnchorWidth ? r.width : undefined),
        top: openUp ? undefined : r.bottom + gap,
        bottom: openUp ? window.innerHeight - r.top + gap : undefined,
        maxHeight: Math.max(160, openUp ? spaceAbove : spaceBelow),
      });
    }

    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef, align, minWidth, matchAnchorWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role={role}
      style={style}
      className={cn("glass-dropdown overflow-y-auto", className)}
    >
      {children}
    </div>,
    document.body,
  );
}
