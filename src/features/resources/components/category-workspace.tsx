"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProjectType } from "@prisma/client";
import { deleteResourceItemAction } from "@/features/resources/actions";
import { ItemModal } from "@/features/resources/components/item-modal";
import type { ResourceCategoryDetail } from "@/features/resources/queries";
import { formatSceneNumber } from "@/features/script/lib/libretto-display";
import { dec } from "@/shared/db/serialize-decimal";
import { formatSecondsMmSs } from "@/shared/i18n/domain-labels";
import { useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

type ItemRow = ResourceCategoryDetail["items"][number];

function itemForModal(item: ItemRow) {
  return {
    name: item.name,
    notes: item.notes,
    shiftRate: dec(item.shiftRate),
    shiftHoursMin: item.shiftHoursMin,
    unpaidOvertimeMin: item.unpaidOvertimeMin,
    arrivalOffsetMin: item.arrivalOffsetMin,
  };
}

function sceneLabel(
  scene: ItemRow["sceneLinks"][number]["scene"],
  projectType: ProjectType,
) {
  return formatSceneNumber(
    {
      episodeNumber: scene.episodeNumber,
      number: scene.number,
      postfix: scene.postfix,
    },
    projectType,
  );
}

function exportCsv(categoryName: string, items: ItemRow[]) {
  const lines = [
    ["Название", "Сцен", "Хронометраж (сек)", "Примечание"].join(";"),
    ...items.map((item) => {
      const seconds = item.sceneLinks.reduce(
        (s, l) => s + (l.scene.planSeconds ?? 0),
        0,
      );
      return [
        item.name,
        String(item._count.sceneLinks),
        String(seconds),
        (item.notes ?? "").replace(/;/g, ","),
      ].join(";");
    }),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${categoryName}-resources.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CategoryWorkspace({
  projectId,
  locale,
  projectType,
  category,
  canWrite,
}: {
  projectId: string;
  locale: string;
  projectType: ProjectType;
  category: ResourceCategoryDetail;
  canWrite: boolean;
}) {
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const toast = useToast();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return category.items;
    return category.items.filter((item) => item.name.toLowerCase().includes(q));
  }, [category.items, search]);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/${locale}/projects/${projectId}/resources`}
          className="text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)]"
        >
          ← Все категории
        </Link>
        <h1 className="font-display mt-2 text-2xl font-semibold">{category.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          {category.fillInScenes ? "Посценный" : ""}
          {category.perShift ? " · Посменный" : ""}
          {category.countable ? " · Счётный" : ""}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-sm"
          placeholder="Поиск элемента…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canWrite ? (
          <Button type="button" onClick={() => { setEditing(null); setModalOpen(true); }}>
            + Добавить элемент
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => exportCsv(category.name, filtered)}
        >
          Экспорт CSV
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Элементы не добавлены.</p>
      ) : (
        <div className="overflow-x-auto glass-card">
          <table className="glass-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-3 py-3">Название</th>
                {category.fillInScenes ? (
                  <>
                    <th className="px-3 py-3">Сцен</th>
                    <th className="px-3 py-3">Сцены</th>
                    <th className="px-3 py-3">Хрон</th>
                  </>
                ) : null}
                {canWrite ? <th className="px-3 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const planSeconds = item.sceneLinks.reduce(
                  (s, l) => s + (l.scene.planSeconds ?? 0),
                  0,
                );
                const sceneNums = item.sceneLinks
                  .map((l) => sceneLabel(l.scene, projectType))
                  .join(", ");
                return (
                  <tr key={item.id} className="border-b border-[var(--border)]/60 align-top">
                    <td className="px-3 py-3 font-medium">
                      <Link
                        href={`/${locale}/projects/${projectId}/resources/${category.id}/items/${item.id}`}
                        className="hover:text-[var(--accent)]"
                      >
                        {item.name}
                      </Link>
                    </td>
                    {category.fillInScenes ? (
                      <>
                        <td className="px-3 py-3">{item._count.sceneLinks}</td>
                        <td className="px-3 py-3 text-[var(--muted-fg)]">
                          {sceneNums || "—"}
                        </td>
                        <td className="px-3 py-3">
                          {planSeconds > 0 ? formatSecondsMmSs(planSeconds) : "—"}
                        </td>
                      </>
                    ) : null}
                    {canWrite ? (
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => { setEditing(item); setModalOpen(true); }}
                          >
                            Изм.
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={async () => {
                              if (!confirm(`Удалить «${item.name}»?`)) return;
                              try {
                                await deleteResourceItemAction(
                                  projectId,
                                  category.id,
                                  item.id,
                                );
                                toast.success("Элемент удалён");
                              } catch (e) {
                                const msg =
                                  e instanceof Error && e.message === "ITEM_IN_SCENES"
                                    ? "Элемент используется в сценах — сначала уберите из сцен"
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ItemModal
        projectId={projectId}
        categoryId={category.id}
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        itemId={editing?.id}
        item={editing ? itemForModal(editing) : undefined}
      />
    </div>
  );
}
