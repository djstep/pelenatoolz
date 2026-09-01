"use client";

import { useState } from "react";
import { SceneResourceCategory } from "@prisma/client";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export type ResourceRow = {
  key: string;
  name: string;
  quantity: number;
};

function newRow(): ResourceRow {
  return {
    key: Math.random().toString(36).slice(2),
    name: "",
    quantity: 1,
  };
}

export function SceneResourceBlock({
  title,
  category,
  nameOptions = [],
  initialRows,
}: {
  title: string;
  category: SceneResourceCategory;
  nameOptions?: string[];
  initialRows?: Array<{ name: string; quantity: number; unitPrice?: number }>;
}) {
  const [rows, setRows] = useState<ResourceRow[]>(() => {
    if (initialRows && initialRows.length > 0) {
      return initialRows.map((r) => ({
        key: Math.random().toString(36).slice(2),
        name: r.name,
        quantity: r.quantity,
      }));
    }
    return [newRow()];
  });

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[var(--muted-fg)]">
              <th className="py-1 pr-2">Название</th>
              <th className="py-1 pr-2 w-20">Кол-во</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key}>
                <td className="py-1 pr-2">
                  <input type="hidden" name={`res_cat_${category}_${index}`} value={category} />
                  <Input
                    name={`res_name_${category}_${index}`}
                    list={`opts_${category}`}
                    value={row.name}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r) =>
                          r.key === row.key ? { ...r, name: e.target.value } : r,
                        ),
                      )
                    }
                    placeholder="Название"
                  />
                </td>
                <td className="py-1 pr-2">
                  <Input
                    name={`res_qty_${category}_${index}`}
                    type="number"
                    min={1}
                    value={row.quantity}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r) =>
                          r.key === row.key
                            ? { ...r, quantity: Number(e.target.value) || 1 }
                            : r,
                        ),
                      )
                    }
                  />
                </td>
                <td className="py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-2"
                    onClick={() =>
                      setRows((prev) =>
                        prev.length <= 1
                          ? [newRow()]
                          : prev.filter((r) => r.key !== row.key),
                      )
                    }
                  >
                    ×
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nameOptions.length > 0 ? (
        <datalist id={`opts_${category}`}>
          {nameOptions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        onClick={() => setRows((prev) => [...prev, newRow()])}
      >
        + Добавить
      </Button>
    </div>
  );
}

export function TagMultiField({
  label,
  name,
  suggestions = [],
  initialTags = [],
}: {
  label: string;
  name: string;
  suggestions?: string[];
  initialTags?: string[];
}) {
  const [tags, setTags] = useState<string[]>(() => [...initialTags]);
  const [draft, setDraft] = useState("");

  function addTag(value: string) {
    const t = value.trim();
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {tags.map((t) => (
        <input key={t} type="hidden" name={name} value={t} />
      ))}
      <div className="flex gap-2">
        <Input
          list={`tag_${name}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag(draft);
            }
          }}
          placeholder="Введите и Enter"
        />
        <Button type="button" variant="secondary" className="px-3" onClick={() => addTag(draft)}>
          +
        </Button>
      </div>
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              className="rounded-md border border-[var(--border)] bg-white/5 px-2 py-0.5 text-xs"
              onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
            >
              {t} ×
            </button>
          ))}
        </div>
      ) : null}
      {suggestions.length > 0 ? (
        <datalist id={`tag_${name}`}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
