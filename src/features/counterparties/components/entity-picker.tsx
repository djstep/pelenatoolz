"use client";

import { useMemo, useState } from "react";
import { CounterpartyType } from "@prisma/client";
import {
  COUNTERPARTY_TYPES,
  counterpartyTypeLabels,
} from "@/features/counterparties/labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { cn } from "@/shared/lib/cn";

export type PickerOption = {
  id: string;
  name: string;
  usageCount?: number;
  subtitle?: string;
};

export function EntityPicker({
  name,
  label,
  options,
  value,
  onChange,
  onQuickCreate,
  placeholder = "Поиск…",
  allowClear = true,
  createTitle = "Быстрое добавление",
  createFields,
}: {
  name: string;
  label: string;
  options: PickerOption[];
  value: string;
  onChange: (id: string) => void;
  onQuickCreate: (form: FormData) => Promise<
    { id: string; name: string } | { error: string }
  >;
  placeholder?: string;
  allowClear?: boolean;
  createTitle?: string;
  createFields?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "create">("list");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");

  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter((o) => o.name.toLowerCase().includes(q))
      : options;
    return list.slice(0, 30);
  }, [options, query]);

  function openCreate(seed = "") {
    setCreateName(seed);
    setCreateError(null);
    setMode("create");
    setOpen(true);
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    setCreating(true);
    setCreateError(null);
    const fd = new FormData(e.currentTarget);
    const result = await onQuickCreate(fd);
    setCreating(false);
    if ("error" in result) {
      setCreateError(result.error);
      return;
    }
    onChange(result.id);
    setMode("list");
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative">
      <Label>{label}</Label>
      <input type="hidden" name={name} value={value} />
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          className="glass-input glass-select-trigger min-w-0 flex-1 truncate rounded-xl text-left text-sm"
          onClick={() => {
            setMode("list");
            setOpen((v) => !v);
          }}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{selected.name}</span>
              {selected.usageCount != null && selected.usageCount > 0 ? (
                <span className="shrink-0 text-[10px] text-[var(--muted-fg)]">
                  ×{selected.usageCount}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-[var(--muted-fg)]">Выберите…</span>
          )}
        </button>
        <Button
          type="button"
          variant="secondary"
          className="px-3"
          title={createTitle}
          onClick={() => openCreate(query.trim())}
        >
          +
        </Button>
      </div>

      {open ? (
        <div className="glass-dropdown absolute z-[80] mt-1.5 w-full p-2 shadow-xl">
          {mode === "list" ? (
            <>
              <input
                autoFocus
                className="glass-input mb-2 w-full rounded-lg px-2 py-1.5 text-sm"
                placeholder={placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ul className="max-h-52 overflow-y-auto text-sm">
                {allowClear ? (
                  <li>
                    <button
                      type="button"
                      className="glass-dropdown-item text-[var(--muted-fg)]"
                      onClick={() => {
                        onChange("");
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      — не указано —
                    </button>
                  </li>
                ) : null}
                {filtered.map((opt) => (
                  <li key={opt.id}>
                    <button
                      type="button"
                      data-selected={opt.id === value ? "true" : undefined}
                      className="glass-dropdown-item"
                      onClick={() => {
                        onChange(opt.id);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {opt.name}
                          {opt.subtitle ? (
                            <span className="ml-1 text-[10px] text-[var(--muted-fg)]">
                              {opt.subtitle}
                            </span>
                          ) : null}
                        </span>
                        {opt.usageCount != null && opt.usageCount > 0 ? (
                          <span className="shrink-0 text-[10px] text-[var(--muted-fg)]">
                            ×{opt.usageCount}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
                {filtered.length === 0 ? (
                  <li className="px-2 py-2 text-[var(--muted-fg)]">
                    Ничего не найдено
                  </li>
                ) : null}
              </ul>
              <button
                type="button"
                className={cn(
                  "mt-1 w-full rounded-md py-1.5 text-xs text-[var(--accent)] hover:bg-white/5",
                )}
                onClick={() => openCreate(query.trim())}
              >
                + Добавить нового
              </button>
            </>
          ) : (
            <form className="space-y-2" onSubmit={handleCreate}>
              <p className="px-1 text-xs font-medium text-[var(--foreground)]">
                {createTitle}
              </p>
              <div>
                <Label htmlFor={`${name}-create-name`}>Название *</Label>
                <Input
                  id={`${name}-create-name`}
                  name="name"
                  required
                  autoFocus
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                />
              </div>
              {createFields}
              {createError ? (
                <p className="text-xs text-[var(--danger)]">{createError}</p>
              ) : null}
              <div className="flex gap-2 pt-1">
                <Button type="submit" className="h-8 px-3 text-xs" disabled={creating}>
                  {creating ? "…" : "Добавить"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => setMode("list")}
                >
                  Назад
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function CounterpartyQuickCreateFields({
  defaultType = "LEGAL_ENTITY",
}: {
  defaultType?: CounterpartyType;
}) {
  return (
    <div>
      <Label htmlFor="cp-type">Тип</Label>
      <Select id="cp-type" name="type" defaultValue={defaultType}>
        {COUNTERPARTY_TYPES.map((t) => (
          <option key={t} value={t}>
            {counterpartyTypeLabels[t]}
          </option>
        ))}
      </Select>
    </div>
  );
}
