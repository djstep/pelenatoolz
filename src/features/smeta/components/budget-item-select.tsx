"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  budgetItemLabel,
  type BudgetItemOption,
} from "@/features/smeta/lib/budget-item-option";
import { cn } from "@/shared/lib/cn";
import { PortaledMenu } from "@/shared/ui/portaled-menu";

/**
 * Выбор статьи сметы с поиском по коду, наименованию и цеху. В списке — только статьи,
 * которые пользователь видит; пустое значение — «без статьи». Статью из чужой сметы,
 * которая уже стоит на записи, поменять нельзя (сервер тоже не даст).
 */
export function BudgetItemSelect({
  id,
  name,
  value,
  onChange,
  options,
  current,
  disabled,
  emptyLabel = "Без статьи",
}: {
  id?: string;
  /** Имя скрытого поля формы с id статьи */
  name?: string;
  value: string;
  onChange: (id: string) => void;
  options: BudgetItemOption[];
  /** Подпись уже выбранной статьи, если её нет в списке (архивная, чужого цеха) */
  current?: BudgetItemOption | null;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.id === value) ?? (value ? current : null);
  const locked = Boolean(value && selected?.hidden);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru-RU");
    if (!q) return options;
    return options.filter((o) =>
      `${o.code} ${o.name} ${o.departmentName}`.toLocaleLowerCase("ru-RU").includes(q),
    );
  }, [options, query]);
  // Первая строка — «без статьи», дальше найденные статьи.
  const choices: (BudgetItemOption | null)[] = [null, ...filtered];

  function commit(next: BudgetItemOption | null) {
    onChange(next?.id ?? "");
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, choices.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const choice = choices[active];
      if (choice !== undefined) commit(choice);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled || locked}
        title={locked ? "Статья из сметы, которую вы не видите — поменять нельзя" : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className={cn(
          "glass-input glass-select-trigger w-full rounded-xl text-left text-sm",
          (disabled || locked) && "cursor-not-allowed opacity-60",
        )}
        onClick={() => {
          setActive(0);
          setOpen((v) => !v);
        }}
      >
        <span className={cn("truncate", !selected && "text-[var(--muted-fg)]")}>
          {selected ? budgetItemLabel(selected) : emptyLabel}
        </span>
      </button>

      <PortaledMenu
        open={open}
        anchorRef={triggerRef}
        onClose={() => {
          setOpen(false);
          setQuery("");
        }}
        id={listboxId}
        matchAnchorWidth
        minWidth={280}
        className="p-1"
      >
        <div className="p-1" data-unsaved-ignore>
          <input
            autoFocus
            value={query}
            placeholder="Код, наименование или цех…"
            className="glass-input w-full rounded-lg px-2 py-1.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {choices.map((choice, index) => (
            <button
              key={choice?.id ?? "__none"}
              type="button"
              role="option"
              aria-selected={(choice?.id ?? "") === value}
              data-selected={(choice?.id ?? "") === value ? "true" : undefined}
              className={cn(
                "glass-dropdown-item w-full text-left",
                index === active && "bg-[var(--accent)]/10",
              )}
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(choice)}
            >
              {choice ? (
                <>
                  <span className="block truncate">
                    <span className="font-mono text-xs">{choice.code}</span> · {choice.name}
                  </span>
                  <span className="block truncate text-xs text-[var(--muted-fg)]">
                    {choice.departmentName}
                  </span>
                </>
              ) : (
                <span className="block truncate text-[var(--muted-fg)]">{emptyLabel}</span>
              )}
            </button>
          ))}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-[var(--muted-fg)]">
              {options.length === 0
                ? "Нет статей в сметах, которые вы видите"
                : "Ничего не найдено"}
            </div>
          ) : null}
        </div>
      </PortaledMenu>
    </div>
  );
}
