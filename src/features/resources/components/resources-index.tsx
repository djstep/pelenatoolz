"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  resourceCategoryPath,
  resourcesBasePath,
} from "@/features/resources/lib/paths";
import { deleteResourceCategoryAction } from "@/features/resources/actions";
import { CategoryModal } from "@/features/resources/components/category-modal";
import type { ResourceCategoryRow } from "@/features/resources/queries";
import { useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

function flagsSummary(c: ResourceCategoryRow) {
  const parts: string[] = [];
  if (c.fillInScenes) parts.push("сцены");
  if (c.perShift) parts.push("смена");
  if (c.countable) parts.push("счётный");
  if (c.showInKpp) parts.push("КПП");
  return parts.join(", ") || "—";
}

export function ResourcesIndex({
  projectId,
  locale,
  categories,
  canWrite,
}: {
  projectId: string;
  locale: string;
  categories: ResourceCategoryRow[];
  canWrite: boolean;
}) {
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ResourceCategoryRow | null>(null);
  const toast = useToast();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, search]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted-fg)]">
        Категории ресурсов: массовка, реквизит, транспорт и др. Элементы
        привязываются к сценам или к сменам в зависимости от настроек категории.
      </p>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-sm"
          placeholder="Поиск категории…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canWrite ? (
          <Button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            + Добавить категорию
          </Button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Категории не созданы.</p>
      ) : (
        <div className="overflow-x-auto glass-card">
          <table className="glass-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-3 py-3">Категория</th>
                <th className="px-3 py-3">Элементов</th>
                <th className="px-3 py-3">Настройки</th>
                {canWrite ? <th className="px-3 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)]/60">
                  <td className="px-3 py-3 font-medium">
                    <Link
                      href={resourceCategoryPath(locale, projectId, c.id)}
                      className="hover:text-[var(--accent)]"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{c._count.items}</td>
                  <td className="px-3 py-3 text-[var(--muted-fg)]">
                    {flagsSummary(c)}
                  </td>
                  {canWrite ? (
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setEditing(c);
                            setModalOpen(true);
                          }}
                        >
                          Изм.
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          onClick={async () => {
                            if (!confirm(`Удалить категорию «${c.name}»?`)) return;
                            try {
                              await deleteResourceCategoryAction(projectId, c.id);
                              toast.success("Категория удалена");
                            } catch (e) {
                              const msg =
                                e instanceof Error && e.message === "CATEGORY_HAS_ITEMS"
                                  ? "Сначала удалите все элементы категории"
                                  : "Не удалось удалить";
                              toast.error(msg);
                            }
                          }}
                        >
                          ×
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CategoryModal
        projectId={projectId}
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        category={editing ?? undefined}
      />
    </div>
  );
}
