"use client";

import { useMemo, useState } from "react";
import { Button } from "@/shared/ui/button";

type Option = { id: string; name: string };

export function CreatableSelect({
  name,
  options,
  value,
  onChange,
  onCreate,
  placeholder = "Поиск…",
  required,
}: {
  name: string;
  options: Option[];
  value: string;
  onChange: (id: string) => void;
  onCreate: (name: string) => Promise<{ id: string; name: string } | { error: string }>;
  placeholder?: string;
  required?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 20);
    return options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 20);
  }, [options, query]);

  const canCreate =
    query.trim().length > 0 &&
    !options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase());

  async function handleCreate() {
    setCreating(true);
    const result = await onCreate(query.trim());
    setCreating(false);
    if ("error" in result) return;
    onChange(result.id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} required={required} />
      <div className="flex gap-2">
        <button
          type="button"
          className="glass-input glass-select-trigger flex-1 truncate rounded-xl text-left text-sm"
          onClick={() => setOpen((v) => !v)}
        >
          {selected?.name ?? "Выберите…"}
        </button>
        <Button
          type="button"
          variant="secondary"
          className="px-3"
          onClick={() => {
            setOpen(true);
            setQuery("");
          }}
        >
          +
        </Button>
      </div>
      {open ? (
        <div className="glass-dropdown absolute z-50 mt-1.5 w-full p-2 shadow-xl">
          <input
            autoFocus
            className="glass-input mb-2 w-full rounded-lg px-2 py-1.5 text-sm"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="max-h-48 overflow-y-auto text-sm">
            {canCreate ? (
              <li>
                <button
                  type="button"
                  disabled={creating}
                  className="glass-dropdown-item text-[var(--accent)]"
                  onClick={handleCreate}
                >
                  «{query.trim()}» (Добавить)
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
                  {opt.name}
                </button>
              </li>
            ))}
            {filtered.length === 0 && !canCreate ? (
              <li className="px-2 py-2 text-[var(--muted-fg)]">Ничего не найдено</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function CreatableMultiSelect({
  name,
  options,
  value,
  onChange,
  onCreate,
  placeholder = "Поиск персонажа…",
}: {
  name: string;
  options: Option[];
  value: string[];
  onChange: (ids: string[]) => void;
  onCreate: (name: string) => Promise<{ id: string; name: string } | { error: string }>;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 20);
    return options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 20);
  }, [options, query]);

  const canCreate =
    query.trim().length > 0 &&
    !options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase());

  const selectedNames = options
    .filter((o) => value.includes(o.id))
    .map((o) => o.name);

  async function handleCreate() {
    setCreating(true);
    const result = await onCreate(query.trim());
    setCreating(false);
    if ("error" in result) return;
    onChange([...value, result.id]);
    setQuery("");
  }

  return (
    <div className="relative space-y-2">
      {value.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <div className="flex gap-2">
        <input
          className="glass-input flex-1 px-3 py-2 text-sm"
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        <Button type="button" variant="secondary" className="px-3" onClick={() => setOpen(true)}>
          +
        </Button>
      </div>
      {selectedNames.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedNames.map((n, i) => (
            <button
              key={value[i]}
              type="button"
              className="rounded-md border border-[var(--border)] bg-white/5 px-2 py-0.5 text-xs"
              onClick={() => onChange(value.filter((id) => id !== value[i]))}
            >
              {n} ×
            </button>
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="glass-dropdown absolute z-50 w-full p-2 shadow-xl">
          <ul className="max-h-48 overflow-y-auto text-sm">
            {canCreate ? (
              <li>
                <button
                  type="button"
                  disabled={creating}
                  className="glass-dropdown-item text-[var(--accent)]"
                  onClick={handleCreate}
                >
                  «{query.trim()}» (Добавить)
                </button>
              </li>
            ) : null}
            {filtered.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  data-selected={value.includes(opt.id) ? "true" : undefined}
                  className="glass-dropdown-item"
                  onClick={() => {
                    if (value.includes(opt.id)) {
                      onChange(value.filter((id) => id !== opt.id));
                    } else {
                      onChange([...value, opt.id]);
                    }
                    setQuery("");
                  }}
                >
                  {opt.name}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-1 w-full rounded-md py-1 text-xs text-[var(--muted-fg)] hover:bg-white/5"
            onClick={() => setOpen(false)}
          >
            Закрыть
          </button>
        </div>
      ) : null}
    </div>
  );
}
