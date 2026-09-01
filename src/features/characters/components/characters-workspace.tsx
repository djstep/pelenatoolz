"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProjectType } from "@prisma/client";
import { deleteCharacterAction } from "@/features/characters/actions";
import { CharacterModal } from "@/features/characters/components/character-modal";
import { CharactersFiltersModal } from "@/features/characters/components/characters-filters-modal";
import {
  applyCharacterFilters,
  emptyCharacterFilters,
  getCharacterCastStatus,
  type CharacterFilters,
} from "@/features/characters/lib/character-filters";
import {
  getEstimatedShiftCount,
  getKppShiftCount,
  getObjectCount,
} from "@/features/characters/lib/character-stats";
import { CHARACTER_COLUMNS } from "@/features/characters/lib/table-columns";
import type { CharacterWithStats } from "@/features/characters/queries";
import { formatSceneNumber } from "@/features/script/lib/libretto-display";
import { formatLocationTitle } from "@/features/locations/lib/format-location";
import { formatSecondsMmSs } from "@/shared/i18n/domain-labels";
import { useTableLayout } from "@/shared/hooks/use-table-layout";
import { useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

const CAST_STATUS_LABELS = {
  APPROVED: "Утверждён",
  HAS_CANDIDATES: "Кандидаты",
  OPEN: "Открыт",
} as const;

type SortDir = "asc" | "desc";

function sortValue(row: CharacterWithStats, colId: string): string | number {
  switch (colId) {
    case "name":
      return row.name;
    case "sceneCount":
      return row.sceneCount;
    case "kppShiftCount":
      return getKppShiftCount(row);
    case "estimatedShiftCount":
      return getEstimatedShiftCount(row);
    case "objectCount":
      return getObjectCount(row);
    case "planSeconds":
      return row.planSeconds;
    case "candidateCount":
      return row.candidateCount;
    case "castStatus":
      return getCharacterCastStatus(row);
    case "approvedActor":
      return row.approvedPersonName ?? "";
    default:
      return "";
  }
}

export function CharactersWorkspace({
  projectId,
  locale,
  projectType,
  characters,
  canWrite,
}: {
  projectId: string;
  locale: string;
  projectType: ProjectType;
  characters: CharacterWithStats[];
  canWrite: boolean;
}) {
  const toast = useToast();
  const {
    visibleIds,
    setVisibleIds,
    widths,
    startResize,
    visibleColumns,
  } = useTableLayout(`characters:${projectId}`, CHARACTER_COLUMNS);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<CharacterFilters>(emptyCharacterFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editCharacter, setEditCharacter] = useState<CharacterWithStats | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<string>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const filtered = useMemo(() => {
    let rows = applyCharacterFilters(characters, filters);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) => {
        const blob = [
          row.name,
          row.description,
          row.roleRequirements,
          row.approvedPersonName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    }

    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sortColumn);
      const bv = sortValue(b, sortColumn);
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv), "ru", { numeric: true }) * dir;
    });
  }, [characters, search, filters, sortColumn, sortDir]);

  function sceneNumbers(row: CharacterWithStats) {
    return row.scenes
      .map((s) =>
        formatSceneNumber(
          {
            episodeNumber: s.scene.episodeNumber,
            number: s.scene.number,
            postfix: s.scene.postfix,
          },
          projectType,
        ),
      )
      .join(", ");
  }

  function locationNames(row: CharacterWithStats) {
    const names = new Set<string>();
    for (const link of row.scenes) {
      for (const loc of link.scene.locations) {
        names.add(formatLocationTitle(loc.location.name, loc.location.sublocation));
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ru")).join(", ");
  }

  function cell(row: CharacterWithStats, colId: string): string {
    switch (colId) {
      case "name":
        return row.name;
      case "description":
        return row.description?.trim() || "—";
      case "roleRequirements":
        return row.roleRequirements?.trim() || "—";
      case "sceneCount":
        return String(row.sceneCount);
      case "kppShiftCount":
        return String(getKppShiftCount(row));
      case "estimatedShiftCount":
        return String(getEstimatedShiftCount(row));
      case "objectCount":
        return String(getObjectCount(row));
      case "sceneNumbers":
        return sceneNumbers(row) || "—";
      case "planSeconds":
        return row.planSeconds > 0 ? formatSecondsMmSs(row.planSeconds) : "—";
      case "locations":
        return locationNames(row) || "—";
      case "candidateCount":
        return String(row.candidateCount);
      case "castStatus":
        return CAST_STATUS_LABELS[getCharacterCastStatus(row)];
      case "approvedActor":
        return row.approvedPersonName ?? "—";
      default:
        return "—";
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted-fg)]">
        Справочник персонажей проекта. Подбор актёров — в{" "}
        <Link
          href={`/${locale}/projects/${projectId}/preproduction/casting`}
          className="text-[var(--accent)] hover:underline"
        >
          Кастинге
        </Link>
        .
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          placeholder="Поиск по имени, описанию, актёру…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="button" variant="secondary" onClick={() => setFiltersOpen(true)}>
          Фильтры
        </Button>
        {canWrite ? (
          <Button
            type="button"
            onClick={() => {
              setEditCharacter(null);
              setModalOpen(true);
            }}
          >
            + Добавить персонажа
          </Button>
        ) : null}
        <div className="relative ml-auto">
          <Button type="button" variant="ghost" onClick={() => setColumnsOpen((v) => !v)}>
            Столбцы
          </Button>
          {columnsOpen ? (
            <div className="absolute right-0 top-full z-20 mt-1 min-w-[12rem] glass-panel p-2 shadow-lg">
              {CHARACTER_COLUMNS.map((col) => (
                <label key={col.id} className="flex items-center gap-2 px-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={visibleIds.has(col.id)}
                    onChange={(e) => {
                      setVisibleIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(col.id);
                        else next.delete(col.id);
                        return next;
                      });
                    }}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Персонажи не найдены.</p>
      ) : (
        <div className="overflow-x-auto glass-card">
          <table className="glass-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                {visibleColumns.map((col) => (
                  <th
                    key={col.id}
                    className="relative cursor-pointer select-none px-3 py-3 font-medium hover:text-[var(--foreground)]"
                    style={{ width: widths[col.id] ?? col.defaultWidth }}
                    onClick={() => {
                      if (sortColumn === col.id) {
                        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                      } else {
                        setSortColumn(col.id);
                        setSortDir("asc");
                      }
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sortColumn === col.id ? (
                        <span className="text-[10px] text-[var(--accent)]">
                          {sortDir === "asc" ? "▲" : "▼"}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--accent)]/40"
                      onMouseDown={(e) => startResize(col.id, e.clientX)}
                    />
                  </th>
                ))}
                {canWrite ? <th className="px-3 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--border)]/60 align-top hover:bg-white/[0.03]"
                >
                  {visibleColumns.map((col) => (
                    <td key={col.id} className="px-3 py-3">
                      {col.id === "name" ? (
                        <Link
                          href={`/${locale}/projects/${projectId}/characters/${row.id}`}
                          className="font-medium hover:text-[var(--accent)]"
                        >
                          {cell(row, col.id)}
                        </Link>
                      ) : col.id === "approvedActor" && row.approvedPersonName ? (
                        <span className="text-emerald-400">{row.approvedPersonName}</span>
                      ) : (
                        <span className={col.id === "description" || col.id === "roleRequirements" ? "line-clamp-2" : undefined}>
                          {cell(row, col.id)}
                        </span>
                      )}
                    </td>
                  ))}
                  {canWrite ? (
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setEditCharacter(row);
                            setModalOpen(true);
                          }}
                        >
                          Изм.
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          onClick={async () => {
                            if (!confirm(`Удалить персонажа «${row.name}»?`)) return;
                            try {
                              await deleteCharacterAction(projectId, row.id);
                              toast.success("Персонаж удалён");
                            } catch {
                              toast.error("Не удалось удалить персонажа");
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

      <CharacterModal
        key={editCharacter?.id ?? "create"}
        projectId={projectId}
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditCharacter(null);
        }}
        character={editCharacter}
      />

      <CharactersFiltersModal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onApply={setFilters}
      />
    </div>
  );
}
