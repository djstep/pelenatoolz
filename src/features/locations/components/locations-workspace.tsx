"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { ProjectType } from "@prisma/client";
import {
  deleteLocationAction,
  getLocationDeleteImpactAction,
  moveSubLocationAction,
} from "@/features/locations/actions";
import { LocationsFiltersModal } from "@/features/locations/components/locations-filters-modal";
import { LocationModal } from "@/features/locations/components/location-modal";
import { LocationMergeModal } from "@/features/locations/components/location-merge-modal";
import { LocationRowMenu } from "@/features/locations/components/location-row-menu";
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
  locationObjectName,
  locationSubName,
  parseTags,
} from "@/features/locations/lib/format-location";
import type { LocationWithStats } from "@/features/locations/queries";
import { formatSceneNumber } from "@/features/script/lib/libretto-display";
import { LOCATION_COLUMNS } from "@/features/script/lib/table-columns";
import { useTableLayout } from "@/shared/hooks/use-table-layout";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
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
  /** «+ подобъект»: окно создания с заполненным объектом. */
  const [subOf, setSubOf] = useState<LocationWithStats | null>(null);
  /** «Объединить с…»: объект или подобъект, который исчезнет. */
  const [mergeOf, setMergeOf] = useState<LocationWithStats | null>(null);
  /** Свёрнутые объекты (их подобъекты не показываются). */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, startMove] = useTransition();
  const confirmDelete = useConfirm();

  const filtered = useMemo(() => {
    let rows = applyLocationFilters(locations, filters);
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((loc) => {
      const blob = [
        locationObjectName(loc),
        locationSubName(loc),
        loc.address,
        loc.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [locations, search, filters]);

  /** Подобъекты каждого объекта по порядку списка (`locations` уже отсортированы). */
  const childrenOf = useMemo(() => {
    const map = new Map<string, LocationWithStats[]>();
    for (const loc of locations) {
      if (!loc.parentId) continue;
      map.set(loc.parentId, [...(map.get(loc.parentId) ?? []), loc]);
    }
    return map;
  }, [locations]);

  /**
   * Строки дерева: найденные поиском и фильтрами, плюс объект каждого найденного подобъекта —
   * подобъект без своего объекта не показывается. Подобъекты свёрнутого объекта скрыты.
   */
  const rows = useMemo(() => {
    const keep = new Set(filtered.map((loc) => loc.id));
    for (const loc of filtered) if (loc.parentId) keep.add(loc.parentId);
    return locations.filter(
      (loc) => keep.has(loc.id) && !(loc.parentId && collapsed.has(loc.parentId)),
    );
  }, [locations, filtered, collapsed]);

  function toggle(objectId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(objectId)) next.delete(objectId);
      else next.add(objectId);
      return next;
    });
  }

  function move(loc: LocationWithStats, direction: "up" | "down") {
    setMoveError(null);
    startMove(async () => {
      const refusal = await moveSubLocationAction(projectId, loc.id, direction);
      if (refusal) setMoveError(refusal);
    });
  }

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
        return formatLocationTitle(loc);
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
              setSubOf(null);
              setModalOpen(true);
            }}
          >
            + Добавить объект
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

      {moveError ? <p className="text-sm text-[var(--danger)]">{moveError}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Объектов пока нет.</p>
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
              {rows.map((loc) => {
                const subs = loc.parentId ? null : (childrenOf.get(loc.id) ?? []);
                const siblings = loc.parentId ? (childrenOf.get(loc.parentId) ?? []) : [];
                const position = siblings.findIndex((s) => s.id === loc.id);
                return (
                <tr
                  key={loc.id}
                  data-location-row={loc.parentId ? "sub" : "object"}
                  className="border-b border-[var(--border)]/60 align-top hover:bg-[rgb(var(--tint-rgb)/0.03)]"
                >
                  {visibleColumns.map((col) => (
                    <td key={col.id} className="px-3 py-3">
                      {col.id === "name" ? (
                        <div className={loc.parentId ? "flex items-start gap-1 pl-6" : "flex items-start gap-1"}>
                          {subs && subs.length > 0 ? (
                            <button
                              type="button"
                              className="w-4 shrink-0 text-[var(--muted-fg)] hover:text-[var(--accent)]"
                              aria-expanded={!collapsed.has(loc.id)}
                              aria-label={`${collapsed.has(loc.id) ? "Развернуть" : "Свернуть"} «${loc.name}»`}
                              onClick={() => toggle(loc.id)}
                            >
                              {collapsed.has(loc.id) ? "▸" : "▾"}
                            </button>
                          ) : (
                            <span className="w-4 shrink-0 text-[var(--muted-fg)]" aria-hidden>
                              {loc.parentId ? "↳" : ""}
                            </span>
                          )}
                          <Link
                            href={`/${locale}/projects/${projectId}/locations/${loc.id}`}
                            className="font-medium hover:text-[var(--accent)]"
                            aria-label={cell(loc, "name")}
                          >
                            {loc.parentId ? locationSubName(loc) : loc.name}
                          </Link>
                          {subs && subs.length > 0 ? (
                            <span className="text-xs text-[var(--muted-fg)]">({subs.length})</span>
                          ) : null}
                        </div>
                      ) : (
                        cell(loc, col.id)
                      )}
                    </td>
                  ))}
                  {canWrite ? (
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex gap-0.5 whitespace-nowrap">
                        {loc.parentId ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              className="px-2"
                              aria-label={`Выше: ${cell(loc, "name")}`}
                              disabled={moving || position <= 0}
                              onClick={() => move(loc, "up")}
                            >
                              ↑
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="px-2"
                              aria-label={`Ниже: ${cell(loc, "name")}`}
                              disabled={moving || position < 0 || position >= siblings.length - 1}
                              onClick={() => move(loc, "down")}
                            >
                              ↓
                            </Button>
                          </>
                        ) : null}
                        <LocationRowMenu
                          title={cell(loc, "name")}
                          items={[
                            ...(loc.parentId
                              ? []
                              : [
                                  {
                                    label: "Добавить подобъект",
                                    onSelect: () => {
                                      setEditLocation(null);
                                      setSubOf(loc);
                                      setModalOpen(true);
                                    },
                                  },
                                ]),
                            {
                              label: "Изменить",
                              onSelect: () => {
                                setEditLocation(loc);
                                setSubOf(null);
                                setModalOpen(true);
                              },
                            },
                            {
                              label: "Объединить с…",
                              onSelect: () => setMergeOf(loc),
                            },
                            {
                              label: "Удалить",
                              danger: true,
                              onSelect: () =>
                                void confirmDelete({
                                  title: `Удалить «${cell(loc, "name")}»?`,
                                  details: () => getLocationDeleteImpactAction(projectId, loc.id),
                                  action: () => deleteLocationAction(projectId, loc.id),
                                }),
                            },
                          ]}
                        />
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

      <LocationModal
        key={editLocation?.id ?? (subOf ? `sub:${subOf.id}` : "create")}
        projectId={projectId}
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditLocation(null); setSubOf(null); }}
        location={editLocation}
        objectName={subOf?.name ?? null}
        objectKind={subOf?.locationKind ?? null}
        addresses={addresses}
      />

      <LocationMergeModal
        key={mergeOf?.id ?? "merge"}
        projectId={projectId}
        source={
          mergeOf
            ? { id: mergeOf.id, title: cell(mergeOf, "name"), isSub: Boolean(mergeOf.parentId) }
            : null
        }
        candidates={
          mergeOf
            ? locations
                .filter((l) => l.id !== mergeOf.id && Boolean(l.parentId) === Boolean(mergeOf.parentId))
                .map((l) => ({ id: l.id, label: cell(l, "name") }))
            : []
        }
        onClose={() => setMergeOf(null)}
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
