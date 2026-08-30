"use client";

import { useMemo, useState, useTransition } from "react";
import type { ProjectType, TimingMode } from "@prisma/client";
import {
  bulkDeleteScenesAction,
  bulkUpdateSceneStatusAction,
  deleteSceneAction,
} from "@/features/script/actions";
import { LibrettoExportModal } from "@/features/script/components/libretto-export-modal";
import { LibrettoFiltersModal } from "@/features/script/components/libretto-filters-modal";
import { LibrettoRenumberModal } from "@/features/script/components/libretto-renumber-modal";
import {
  SceneModal,
  type SceneEditData,
} from "@/features/script/components/scene-modal";
import {
  formatSceneNumber,
  getStatusDateLabel,
  type LibrettoScene,
} from "@/features/script/lib/libretto-display";
import { getLibrettoCellValue } from "@/features/script/lib/libretto-cell-values";
import { exportLibrettoXls } from "@/features/script/lib/libretto-export-xls";
import {
  applyLibrettoFilters,
  emptyFilters,
  type LibrettoFilters,
} from "@/features/script/lib/libretto-filters";
import { LIBRETTO_COLUMNS } from "@/features/script/lib/table-columns";
import type { LibrettoExportColumn } from "@/features/script/lib/libretto-fields";
import {
  sceneStatusColors,
  sceneStatusRowColors,
} from "@/shared/i18n/domain-labels";
import { useTableLayout } from "@/shared/hooks/use-table-layout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";

type Option = { id: string; name: string };

function cellValue(
  scene: LibrettoScene,
  colId: string,
  projectType: ProjectType,
): string {
  return getLibrettoCellValue(scene, colId, projectType);
}

export function LibrettoWorkspace({
  projectId,
  locale,
  projectType,
  shootOnFilm,
  timingMode = "MINUTES",
  pageToMinuteRatio = 1,
  scenes,
  locations,
  characters,
  canWrite,
}: {
  projectId: string;
  locale: string;
  projectType: ProjectType;
  shootOnFilm: boolean;
  timingMode?: TimingMode;
  pageToMinuteRatio?: number;
  scenes: LibrettoScene[];
  locations: Option[];
  characters: Option[];
  canWrite: boolean;
}) {
  const {
    visibleIds,
    setVisibleIds,
    widths,
    colorMode,
    setColorMode,
    startResize,
    visibleColumns,
  } = useTableLayout(`libretto:${projectId}`, LIBRETTO_COLUMNS);

  const [filters, setFilters] = useState<LibrettoFilters>(() => emptyFilters());
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [renumberOpen, setRenumberOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<SceneEditData | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const fmtNum = (s: LibrettoScene) => formatSceneNumber(s, projectType);

  const activeFilters = useMemo(
    () => ({ ...filters, search }),
    [filters, search],
  );

  const filtered = useMemo(
    () => applyLibrettoFilters(scenes, activeFilters, fmtNum),
    [scenes, activeFilters, projectType],
  );

  const shootingUnits = useMemo(() => {
    const units = new Set<string>();
    for (const s of scenes) {
      if (s.shootingUnit) units.add(s.shootingUnit);
      for (const d of s.shootDayScenes) {
        if (d.shootDay.unit) units.add(d.shootDay.unit);
      }
    }
    return Array.from(units).sort();
  }, [scenes]);

  function openCreate() {
    setEditingScene(null);
    setModalOpen(true);
  }

  function openEdit(scene: LibrettoScene) {
    setEditingScene(scene as SceneEditData);
    setModalOpen(true);
  }

  function exportXls(exportColumns: LibrettoExportColumn[]) {
    void exportLibrettoXls(filtered, projectType, exportColumns, projectId);
  }

  const selectedIds = Array.from(selected);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Поиск: объект, персонаж, сцена, описание…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="button" variant="secondary" onClick={() => setFiltersOpen(true)}>
          Фильтры
        </Button>
        <label className="flex items-center gap-2 text-sm text-[var(--muted-fg)]">
          <input
            type="checkbox"
            checked={colorMode}
            onChange={(e) => setColorMode(e.target.checked)}
          />
          Цветной режим
        </label>
        {canWrite ? (
          <Button type="button" onClick={openCreate}>+ Добавить сцену</Button>
        ) : null}
        {canWrite ? (
          <Button type="button" variant="secondary" onClick={() => setRenumberOpen(true)}>
            Перенумерация
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => setExportOpen(true)}>
          Экспорт
        </Button>
        <div className="relative ml-auto">
          <Button type="button" variant="ghost" onClick={() => setColumnsOpen((v) => !v)}>
            Столбцы
          </Button>
          {columnsOpen ? (
            <div className="absolute right-0 top-full z-20 mt-1 min-w-[14rem] glass-panel p-2 shadow-lg">
              {LIBRETTO_COLUMNS.map((col) => (
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

      {canWrite && selected.size > 0 ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[var(--muted-fg)]">Выбрано: {selected.size}</span>
          <Button type="button" variant="secondary" onClick={() => setBulkOpen((v) => !v)}>
            Групповые действия
          </Button>
          {bulkOpen ? (
            <div className="flex flex-wrap gap-1">
              {(["PLANNING", "SHOT", "NOT_SHOT", "RESHOOT_REQUIRED", "OFF_PLAN"] as const).map(
                (st) => (
                  <Button
                    key={st}
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await bulkUpdateSceneStatusAction(projectId, selectedIds, st);
                        setSelected(new Set());
                        setMessage(`Статус обновлён (${selectedIds.length})`);
                      })
                    }
                  >
                    {st}
                  </Button>
                ),
              )}
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Удалить ${selected.size} сцен?`)) return;
                  startTransition(async () => {
                    await bulkDeleteScenesAction(projectId, selectedIds);
                    setSelected(new Set());
                  });
                }}
              >
                Удалить
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
      <p className="text-xs text-[var(--muted-fg)]">
        Показано {filtered.length} из {scenes.length} сцен
      </p>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Нет сцен по текущим фильтрам.</p>
      ) : (
        <div className="overflow-x-auto glass-card">
          <table className="glass-table w-full text-left text-sm" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                {canWrite ? <th className="w-8 px-2 py-3" /> : null}
                {visibleColumns.map((col) => (
                  <th
                    key={col.id}
                    className="relative px-2 py-3 font-medium"
                    style={{ width: widths[col.id] ?? col.defaultWidth }}
                  >
                    {col.label}
                    <span
                      role="separator"
                      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--accent)]/40"
                      onMouseDown={(e) => startResize(col.id, e.clientX)}
                    />
                  </th>
                ))}
                {canWrite ? <th className="w-24 px-2 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((scene) => (
                <tr
                  key={scene.id}
                  className={cn(
                    "border-b border-[var(--border)]/60 align-top",
                    canWrite && "cursor-pointer",
                    colorMode && sceneStatusRowColors[scene.status],
                  )}
                  onClick={(e) => {
                    if (!canWrite) return;
                    if ((e.target as HTMLElement).closest("input, button, form")) return;
                    openEdit(scene);
                  }}
                >
                  {canWrite ? (
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(scene.id)}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(scene.id);
                            else next.delete(scene.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                  ) : null}
                  {visibleColumns.map((col) => (
                    <td
                      key={col.id}
                      className="truncate px-2 py-2"
                      style={{ maxWidth: widths[col.id] ?? col.defaultWidth }}
                      title={cellValue(scene, col.id, projectType)}
                    >
                      {col.id === "status" ? (
                        colorMode ? (
                          <Badge className={sceneStatusColors[scene.status]}>
                            {getStatusDateLabel(scene)}
                          </Badge>
                        ) : (
                          getStatusDateLabel(scene)
                        )
                      ) : (
                        cellValue(scene, col.id, projectType)
                      )}
                    </td>
                  ))}
                  {canWrite ? (
                    <td className="px-2 py-2 text-right">
                      <Button type="button" variant="ghost" onClick={() => openEdit(scene)}>
                        Изм.
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SceneModal
        key={editingScene?.id ?? "create"}
        projectId={projectId}
        projectType={projectType}
        shootOnFilm={shootOnFilm}
        timingMode={timingMode}
        pageToMinuteRatio={pageToMinuteRatio}
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingScene(null); }}
        locations={locations}
        characters={characters}
        scene={editingScene}
      />

      <LibrettoFiltersModal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={{ ...filters, search }}
        onApply={(f) => { setFilters(f); setSearch(f.search); }}
        shootingUnits={shootingUnits}
      />
      <LibrettoExportModal open={exportOpen} onClose={() => setExportOpen(false)} onExport={exportXls} />
      <LibrettoRenumberModal
        open={renumberOpen}
        onClose={() => setRenumberOpen(false)}
        projectId={projectId}
        projectType={projectType}
        scenes={scenes}
      />
    </div>
  );
}
