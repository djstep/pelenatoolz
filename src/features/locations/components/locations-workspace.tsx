"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProjectType } from "@prisma/client";
import { deleteLocationAction } from "@/features/locations/actions";
import { LocationsFiltersModal } from "@/features/locations/components/locations-filters-modal";
import { LocationModal } from "@/features/locations/components/location-modal";
import {
  applyLocationFilters,
  emptyLocationFilters,
  getEstimatedShiftCount,
  getKppShiftCount,
  type LocationFilters,
} from "@/features/locations/lib/location-filters";
import {
  formatLocationKind,
  formatLocationTitle,
  parseTags,
} from "@/features/locations/lib/format-location";
import type { LocationWithStats } from "@/features/locations/queries";
import { formatSceneNumber } from "@/features/script/lib/libretto-display";
import { LOCATION_COLUMNS } from "@/features/script/lib/table-columns";
import { useTableLayout } from "@/shared/hooks/use-table-layout";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

export function LocationsWorkspace({
  locale,
  projectId,
  projectType,
  locations,
  addresses,
  canWrite,
}: {
  locale: string;
  projectId: string;
  projectType: ProjectType;
  locations: LocationWithStats[];
  addresses: string[];
  canWrite: boolean;
}) {
  const {
    visibleIds,
    setVisibleIds,
    widths,
    startResize,
    visibleColumns,
  } = useTableLayout(`locations:${projectId}`, LOCATION_COLUMNS);

  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<LocationFilters>(emptyLocationFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editLocation, setEditLocation] = useState<LocationWithStats | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const filtered = useMemo(() => {
    let rows = applyLocationFilters(locations, filters);
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((loc) => {
      const blob = [
        loc.name,
        loc.sublocation,
        loc.address,
        loc.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [locations, search, filters]);

  function sceneNumbers(loc: LocationWithStats) {
    return loc.scenes
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

  function characters(loc: LocationWithStats) {
    const names = new Set<string>();
    for (const link of loc.scenes) {
      for (const c of link.scene.characters) {
        names.add(c.character.name);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ru")).join(", ");
  }

  function shiftCount(loc: LocationWithStats) {
    return getKppShiftCount(loc);
  }

  function estimatedShifts(loc: LocationWithStats) {
    return getEstimatedShiftCount(loc);
  }

  function cell(loc: LocationWithStats, colId: string): string {
    switch (colId) {
      case "name":
        return formatLocationTitle(loc.name, loc.sublocation);
      case "kind":
        return formatLocationKind(loc.locationKind);
      case "address":
        return loc.address ?? "—";
      case "decoration":
        return loc.hasDecoration ? "Да" : "—";
      case "sceneCount":
        return String(loc._count.scenes);
      case "sceneNumbers":
        return sceneNumbers(loc) || "—";
      case "characters":
        return characters(loc) || "—";
      case "shiftCount":
        return String(shiftCount(loc));
      case "estimatedShifts":
        return String(estimatedShifts(loc));
      case "tags":
        return parseTags(loc.tags).join(", ") || "—";
      default:
        return "—";
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          placeholder="Поиск по названию или адресу…"
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
              setEditLocation(null);
              setModalOpen(true);
            }}
          >
            + Добавить локацию
          </Button>
        ) : null}
        <div className="relative ml-auto">
          <Button type="button" variant="ghost" onClick={() => setColumnsOpen((v) => !v)}>
            Столбцы
          </Button>
          {columnsOpen ? (
            <div className="absolute right-0 top-full z-20 mt-1 min-w-[12rem] glass-panel p-2 shadow-lg">
              {LOCATION_COLUMNS.map((col) => (
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
        <p className="text-sm text-[var(--muted-fg)]">Локаций пока нет.</p>
      ) : (
        <div className="overflow-x-auto glass-card">
          <table className="glass-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                {visibleColumns.map((col) => (
                  <th
                    key={col.id}
                    className="relative px-3 py-3 font-medium"
                    style={{ width: widths[col.id] ?? col.defaultWidth }}
                  >
                    {col.label}
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
              {filtered.map((loc) => (
                <tr key={loc.id} className="border-b border-[var(--border)]/60 align-top hover:bg-white/[0.03]">
                  {visibleColumns.map((col) => (
                    <td key={col.id} className="px-3 py-3">
                      {col.id === "name" ? (
                        <Link
                          href={`/${locale}/projects/${projectId}/locations/${loc.id}`}
                          className="font-medium hover:text-[var(--accent)]"
                        >
                          {cell(loc, col.id)}
                        </Link>
                      ) : (
                        cell(loc, col.id)
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
                            setEditLocation(loc);
                            setModalOpen(true);
                          }}
                        >
                          Изм.
                        </Button>
                        <form
                          action={async () => {
                            if (confirm("Удалить локацию?")) {
                              await deleteLocationAction(projectId, loc.id);
                            }
                          }}
                        >
                          <Button type="submit" variant="danger">×</Button>
                        </form>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LocationModal
        key={editLocation?.id ?? "create"}
        projectId={projectId}
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditLocation(null); }}
        location={editLocation}
        addresses={addresses}
      />

      <LocationsFiltersModal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        onApply={setFilters}
        addresses={addresses}
      />
    </div>
  );
}
