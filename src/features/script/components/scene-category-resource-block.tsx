"use client";

import { useState } from "react";
import { quickCreateResourceItemAction } from "@/features/resources/actions";
import { CreatableSelect } from "@/shared/ui/creatable-select";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export type SceneCategoryOption = {
  id: string;
  name: string;
  countable: boolean;
  items: { id: string; name: string }[];
};

type LinkRow = {
  key: string;
  itemId: string;
  quantity: number;
};

function newRow(): LinkRow {
  return { key: Math.random().toString(36).slice(2), itemId: "", quantity: 1 };
}

export function SceneCategoryResourceBlock({
  projectId,
  category,
  initialLinks = [],
}: {
  projectId: string;
  category: SceneCategoryOption;
  initialLinks?: Array<{ itemId: string; quantity: number }>;
}) {
  const [items, setItems] = useState(category.items);
  const [rows, setRows] = useState<LinkRow[]>(() => {
    if (initialLinks.length > 0) {
      return initialLinks.map((l) => ({
        key: Math.random().toString(36).slice(2),
        itemId: l.itemId,
        quantity: l.quantity,
      }));
    }
    return [newRow()];
  });

  async function handleCreate(name: string) {
    const result = await quickCreateResourceItemAction(projectId, category.id, name);
    if ("error" in result) return result;
    setItems((prev) => {
      if (prev.some((i) => i.id === result.id)) return prev;
      return [...prev, { id: result.id, name: result.name }].sort((a, b) =>
        a.name.localeCompare(b.name, "ru"),
      );
    });
    return result;
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{category.name}</h4>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.key} className="flex flex-wrap items-end gap-2">
            <input
              type="hidden"
              name={`cri_item_${category.id}_${index}`}
              value={row.itemId}
            />
            <div className="min-w-[12rem] flex-1">
              <CreatableSelect
                name={`cri_item_ui_${category.id}_${index}`}
                options={items}
                value={row.itemId}
                onChange={(id) =>
                  setRows((prev) =>
                    prev.map((r) => (r.key === row.key ? { ...r, itemId: id } : r)),
                  )
                }
                onCreate={handleCreate}
                placeholder="Поиск ресурса…"
              />
            </div>
            {category.countable ? (
              <div className="w-24">
                <Input
                  name={`cri_qty_${category.id}_${index}`}
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
              </div>
            ) : (
              <input
                type="hidden"
                name={`cri_qty_${category.id}_${index}`}
                value={1}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              className="px-2"
              onClick={() =>
                setRows((prev) =>
                  prev.length <= 1 ? [newRow()] : prev.filter((r) => r.key !== row.key),
                )
              }
            >
              ×
            </Button>
          </div>
        ))}
      </div>
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
