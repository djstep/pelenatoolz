"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@/shared/lib/cn";
import { PortaledMenu } from "@/shared/ui/portaled-menu";

export type AutocompleteOption = {
  value: string;
  label: string;
  hint?: string;
};

type Props = {
  id?: string;
  name: string;
  defaultValue?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  loading?: boolean;
  minChars?: number;
  emptyText?: string;
  options: AutocompleteOption[];
  onQueryChange?: (query: string) => void;
  onValueChange?: (value: string) => void;
  onSelect?: (option: AutocompleteOption) => void;
  onBlurNormalize?: (value: string) => string | null;
  displayValue?: (value: string) => string;
};

export function AutocompleteInput({
  id,
  name,
  defaultValue = "",
  value,
  placeholder,
  disabled,
  required,
  loading = false,
  minChars = 1,
  emptyText = "Ничего не найдено",
  options,
  onQueryChange,
  onValueChange,
  onSelect,
  onBlurNormalize,
  displayValue,
}: Props) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const isControlled = value !== undefined;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultValue);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [submittedValue, setSubmittedValue] = useState(defaultValue);

  const currentQuery = isControlled ? (value ?? "") : query;
  const visibleValue = displayValue
    ? displayValue(currentQuery)
    : currentQuery;

  useEffect(() => {
    if (isControlled) {
      setSubmittedValue(value ?? "");
    }
  }, [isControlled, value]);

  function updateValue(next: string) {
    setSubmittedValue(next);
    if (!isControlled) setQuery(next);
    onValueChange?.(next);
  }

  function handleInputChange(next: string) {
    updateValue(next);
    onQueryChange?.(next);
    setOpen(next.trim().length >= minChars);
    setActiveIndex(-1);
  }

  function commitOption(option: AutocompleteOption) {
    updateValue(option.value);
    onSelect?.(option);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleBlur() {
    const normalized = onBlurNormalize?.(submittedValue);
    if (normalized && normalized !== submittedValue) {
      updateValue(normalized);
    }
    window.setTimeout(() => {
      setOpen(false);
      setActiveIndex(-1);
    }, 120);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      if (currentQuery.trim().length >= minChars) setOpen(true);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (!open || options.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        index <= 0 ? options.length - 1 : index - 1,
      );
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) commitOption(option);
    }
  }

  const showDropdown =
    open && currentQuery.trim().length >= minChars && !disabled;

  return (
    <div className="relative">
      <input type="hidden" name={name} value={submittedValue} />
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={visibleValue}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className={cn(
          "glass-input w-full rounded-xl px-3 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]",
          disabled && "cursor-not-allowed opacity-60",
        )}
        onChange={(event) => handleInputChange(event.target.value)}
        onFocus={() => {
          if (currentQuery.trim().length >= minChars) setOpen(true);
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />

      <PortaledMenu
        open={showDropdown}
        anchorRef={inputRef}
        onClose={() => {
          setOpen(false);
          setActiveIndex(-1);
        }}
        id={listboxId}
        matchAnchorWidth
        className="p-1"
      >
        {loading ? (
          <div className="px-3 py-2 text-sm text-[var(--muted-fg)]">
            Поиск…
          </div>
        ) : options.length === 0 ? (
          <div className="px-3 py-2 text-sm text-[var(--muted-fg)]">
            {emptyText}
          </div>
        ) : (
          options.map((option, index) => (
            <button
              key={`${option.value}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "glass-dropdown-item w-full text-left",
                index === activeIndex && "bg-[var(--accent)]/10",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitOption(option)}
            >
              <span className="block truncate">{option.label}</span>
              {option.hint ? (
                <span className="mt-0.5 block truncate text-xs text-[var(--muted-fg)]">
                  {option.hint}
                </span>
              ) : null}
            </button>
          ))
        )}
      </PortaledMenu>
    </div>
  );
}
