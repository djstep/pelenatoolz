"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
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

function setNativeSelectValue(select: HTMLSelectElement, next: string) {
  const previous = select.value;
  select.value = next;
  const tracker = (
    select as HTMLSelectElement & {
      _valueTracker?: { setValue: (value: string) => void };
    }
  )._valueTracker;
  tracker?.setValue(previous);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

export function Select({
  className,
  children,
  id,
  name,
  value,
  defaultValue,
  onChange,
  required,
  disabled,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = parseOptions(children);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const isControlled = value !== undefined;
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(() =>
    String(
      value ??
        defaultValue ??
        options.find((o) => !o.disabled)?.value ??
        "",
    ),
  );

  const currentValue = isControlled ? String(value) : internalValue;
  const selected = options.find((o) => o.value === currentValue);

  useEffect(() => {
    if (isControlled) {
      setInternalValue(String(value));
    }
  }, [isControlled, value]);

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

  function handleNativeChange(event: ChangeEvent<HTMLSelectElement>) {
    if (!isControlled) {
      setInternalValue(event.target.value);
    }
    onChange?.(event);
  }

  function commitValue(nextValue: string) {
    setOpen(false);
    const native = nativeRef.current;
    if (!native) {
      if (!isControlled) setInternalValue(nextValue);
      return;
    }
    setNativeSelectValue(native, nextValue);
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <select
        ref={nativeRef}
        id={id}
        name={name}
        value={currentValue}
        required={required}
        disabled={disabled}
        onChange={handleNativeChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      >
        {children}
      </select>

      <button
        type="button"
        id={id ? `${id}-trigger` : undefined}
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
          className={cn("truncate", !selected?.label && "text-[var(--muted)]")}
        >
          {selected?.label || "Выберите…"}
        </span>
        <ChevronDown open={open} />
      </button>

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-labelledby={id ? `${id}-trigger` : undefined}
          className="glass-dropdown absolute z-50 mt-1.5 max-h-60 w-full overflow-y-auto"
        >
          {options.map((option) => (
            <li key={option.value || "__empty"} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={option.value === currentValue}
                disabled={option.disabled}
                data-selected={
                  option.value === currentValue ? "true" : undefined
                }
                className="glass-dropdown-item"
                onClick={() => {
                  if (!option.disabled) commitValue(option.value);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
