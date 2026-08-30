"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { cn } from "@/shared/lib/cn";

type OptionData = {
  value: string;
  label: string;
  disabled?: boolean;
};

function parseOptions(children: ReactNode): OptionData[] {
  const options: OptionData[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === "option") {
      const props = child.props as {
        value?: string;
        disabled?: boolean;
        children?: ReactNode;
      };
      options.push({
        value: props.value ?? "",
        label: String(props.children ?? ""),
        disabled: props.disabled,
      });
    }
  });
  return options;
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cn(
        "shrink-0 text-[var(--muted-fg)] transition-transform duration-200",
        open && "rotate-180",
      )}
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MultiSelect({
  className,
  children,
  hint,
  id,
  name,
  defaultValue,
  disabled,
}: SelectHTMLAttributes<HTMLSelectElement> & { hint?: string }) {
  const options = parseOptions(children);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => {
    if (defaultValue == null) return [];
    return Array.isArray(defaultValue)
      ? defaultValue.map(String)
      : [String(defaultValue)];
  });

  const selectedLabels = options
    .filter((o) => selected.includes(o.value))
    .map((o) => o.label);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleValue(optionValue: string) {
    setSelected((prev) =>
      prev.includes(optionValue)
        ? prev.filter((v) => v !== optionValue)
        : [...prev, optionValue],
    );
  }

  return (
    <div className="space-y-1">
      <div ref={containerRef} className={cn("relative", className)}>
        {selected.map((value) => (
          <input key={value} type="hidden" name={name} value={value} />
        ))}

        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          className={cn(
            "glass-input glass-select-trigger w-full rounded-xl text-sm",
            disabled && "cursor-not-allowed opacity-60",
          )}
          onClick={() => {
            if (!disabled) setOpen((v) => !v);
          }}
        >
          <span
            className={cn(
              "truncate",
              selectedLabels.length === 0 && "text-[var(--muted)]",
            )}
          >
            {selectedLabels.length > 0
              ? selectedLabels.join(", ")
              : "Выберите…"}
          </span>
          <ChevronDown open={open} />
        </button>

        {open ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-multiselectable
            className="glass-dropdown absolute z-50 mt-1.5 max-h-60 w-full overflow-y-auto"
          >
            {options.map((option) => {
              const isSelected = selected.includes(option.value);
              return (
                <li key={option.value} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    data-selected={isSelected ? "true" : undefined}
                    className="glass-dropdown-item"
                    onClick={() => {
                      if (!option.disabled) toggleValue(option.value);
                    }}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-[var(--border-strong)] bg-white/5",
                      )}
                      aria-hidden
                    >
                      {isSelected ? (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path
                            d="M2 5l2.5 2.5L8 3"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </span>
                    {option.label}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {selectedLabels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedLabels.map((label, index) => (
            <button
              key={selected[index]}
              type="button"
              disabled={disabled}
              className="rounded-md border border-[var(--border)] bg-white/5 px-2 py-0.5 text-xs text-[var(--muted-fg)] hover:bg-white/10"
              onClick={() => toggleValue(selected[index]!)}
            >
              {label} ×
            </button>
          ))}
        </div>
      ) : null}

      {hint ? (
        <p className="text-xs text-[var(--muted-fg)]">
          {hint === "Ctrl+клик для нескольких"
            ? "Можно выбрать несколько"
            : hint}
        </p>
      ) : null}
    </div>
  );
}
