"use client";

import { ProjectType } from "@prisma/client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  getExportLayoutAction,
  saveExportLayoutAction,
} from "@/features/exports/actions";
import { ExportColumnBuilder } from "@/features/exports/components/export-column-builder";
import {
  columnsReadyForExport,
  createExportColumnId,
} from "@/features/exports/lib/column-utils";
import type { ExportColumn, ExportFieldDef } from "@/features/exports/types";
import { getKppExportBundleAction } from "@/features/schedule/actions-export";
import type { KppExportBundle } from "@/features/schedule/lib/kpp-export-data";
import { exportKppXls } from "@/features/schedule/lib/export-kpp-xls";
import {
  buildKppFullExportFields,
  buildKppShortExportFields,
  createDefaultKppFullColumns,
  createDefaultKppShortColumns,
  kppFieldLabelsMap,
} from "@/features/schedule/lib/kpp-export-fields";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/cn";

export type KppExportMode = "full" | "short";

function unitLabel(unit: string) {
  return unit === "main" ? "Основная группа" : unit;
}

export function KppExportMenu({
  projectId,
  projectType,
}: {
  projectId: string;
  projectType: ProjectType;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<KppExportMode | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        variant="secondary"
        onClick={() => setMenuOpen((v) => !v)}
      >
        Экспорт
      </Button>
      {menuOpen ? (
        <div className="glass-panel absolute right-0 top-full z-30 mt-1 min-w-[12rem] overflow-hidden rounded-xl py-1 shadow-lg">
          <button
            type="button"
            className="glass-dropdown-item block w-full px-3 py-2 text-left text-sm"
            onClick={() => {
              setMode("full");
              setMenuOpen(false);
            }}
          >
            Полный КПП
          </button>
          <button
            type="button"
            className="glass-dropdown-item block w-full px-3 py-2 text-left text-sm"
            onClick={() => {
              setMode("short");
              setMenuOpen(false);
            }}
          >
            Краткий КПП
          </button>
        </div>
      ) : null}

      {mode ? (
        <KppExportModal
          open
          mode={mode}
          projectId={projectId}
          projectType={projectType}
          onClose={() => setMode(null)}
        />
      ) : null}
    </div>
  );
}

function KppExportModal({
  open,
  onClose,
  mode,
  projectId,
  projectType,
}: {
  open: boolean;
  onClose: () => void;
  mode: KppExportMode;
  projectId: string;
  projectType: ProjectType;
}) {
  const toast = useToast();
  const [bundle, setBundle] = useState<KppExportBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  const [columns, setColumns] = useState<ExportColumn[]>([]);
  const [includeBreaks, setIncludeBreaks] = useState(true);
  const [showWeekday, setShowWeekday] = useState(true);
  const [unitScope, setUnitScope] = useState<"all" | string>("all");
  const [selectedUnit, setSelectedUnit] = useState("main");

  const layoutKey = mode === "full" ? "kppFull" : "kppShort";
  const title =
    mode === "full" ? "Настройки экспорта · полный КПП" : "Настройки экспорта · краткий КПП";

  const fields: ExportFieldDef[] = useMemo(() => {
    if (mode === "full") {
      return buildKppFullExportFields(bundle?.resourceCategories ?? []);
    }
    return buildKppShortExportFields();
  }, [mode, bundle?.resourceCategories]);

  const fieldLabels = useMemo(() => kppFieldLabelsMap(fields), [fields]);

  const multiUnit =
    (bundle?.units.length ?? 0) > 1 || (bundle?.cameraUnits ?? 1) > 1;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      getKppExportBundleAction(projectId),
      getExportLayoutAction(projectId, layoutKey),
    ]).then(([dataResult, layoutResult]) => {
      if (cancelled) return;
      if (dataResult.error) toast.error(dataResult.error);
      const nextBundle = dataResult.bundle ?? null;
      setBundle(nextBundle);

      const cats = nextBundle?.resourceCategories ?? [];
      const units = nextBundle?.units ?? ["main"];
      setSelectedUnit(units[0] ?? "main");
      setUnitScope(units.length > 1 ? units[0]! : "all");

      if (layoutResult.layout?.columns?.length) {
        setColumns(layoutResult.layout.columns);
        if (typeof layoutResult.layout.includeTechnicalBreaks === "boolean") {
          setIncludeBreaks(layoutResult.layout.includeTechnicalBreaks);
        }
        if (typeof layoutResult.layout.showWeekday === "boolean") {
          setShowWeekday(layoutResult.layout.showWeekday);
        }
      } else if (mode === "full") {
        setColumns(createDefaultKppFullColumns(cats));
      } else {
        setColumns(createDefaultKppShortColumns(true));
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, layoutKey, mode]);

  function resetDefaults() {
    if (mode === "full") {
      setColumns(createDefaultKppFullColumns(bundle?.resourceCategories ?? []));
    } else {
      setColumns(createDefaultKppShortColumns(showWeekday));
    }
  }

  function onToggleWeekday(next: boolean) {
    setShowWeekday(next);
    // Sync weekday column presence with checkbox for short mode
    if (mode !== "short") return;
    setColumns((prev) => {
      const has = prev.some((c) => c.fieldIds.includes("weekday"));
      if (next && !has) {
        return [
          ...prev.slice(0, 2),
          { id: "weekday", title: "День недели", fieldIds: ["weekday"] },
          ...prev.slice(2),
        ];
      }
      if (!next && has) {
        return prev.filter((c) => !c.fieldIds.includes("weekday"));
      }
      return prev;
    });
  }

  function runExport() {
    if (!bundle) return;
    const ready = columnsReadyForExport(columns);
    if (ready.length === 0) return;

    const scope =
      multiUnit && unitScope !== "all" ? selectedUnit : unitScope;

    startTransition(async () => {
      const save = await saveExportLayoutAction(projectId, layoutKey, columns, {
        includeTechnicalBreaks: mode === "full" ? includeBreaks : undefined,
        showWeekday: mode === "short" ? showWeekday : undefined,
      });
      if (save.error) toast.warning(save.error);

      try {
        await exportKppXls(bundle, {
          mode,
          columns: ready,
          fieldLabels,
          includeTechnicalBreaks: mode === "full" && includeBreaks,
          showWeekday: mode === "short" && showWeekday,
          unitScope: multiUnit ? (unitScope === "all" ? "all" : scope) : "all",
          projectType,
        });
        onClose();
      } catch {
        toast.error("Не удалось сформировать файл");
      }
    });
  }

  const canExport = columns.some((c) => c.fieldIds.length > 0) && Boolean(bundle);

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <p className="mb-3 text-sm text-[var(--muted-fg)]">
        {mode === "full"
          ? "Подробная таблица по сценам смены. Столбцы настраиваются конструктором; раскладка сохраняется в проекте."
          : "Сводка по съёмочным дням без детализации сцен. Раскладка сохраняется в проекте."}
      </p>

      <div className="mb-4 space-y-3">
        {mode === "full" ? (
          <Checkbox
            checked={includeBreaks}
            disabled={loading || (bundle != null && !bundle.hasTechnicalBreaks)}
            onChange={(e) => setIncludeBreaks(e.target.checked)}
            label={
              bundle && !bundle.hasTechnicalBreaks
                ? "Выводить технические перерывы (в вызывных пока нет)"
                : "Выводить технические перерывы"
            }
          />
        ) : (
          <Checkbox
            checked={showWeekday}
            disabled={loading}
            onChange={(e) => onToggleWeekday(e.target.checked)}
            label="Показывать дни недели"
          />
        )}

        {multiUnit ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3 space-y-2">
            <p className="text-xs font-medium text-[var(--muted-fg)]">
              Съёмочные группы
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="unitScope"
                  checked={unitScope !== "all"}
                  onChange={() => setUnitScope(selectedUnit)}
                />
                Только выбранная
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="unitScope"
                  checked={unitScope === "all"}
                  onChange={() => setUnitScope("all")}
                />
                Все группы (отдельный лист)
              </label>
            </div>
            {unitScope !== "all" ? (
              <Select
                value={selectedUnit}
                onChange={(e) => {
                  setSelectedUnit(e.target.value);
                  setUnitScope(e.target.value);
                }}
              >
                {(bundle?.units ?? ["main"]).map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u)}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={resetDefaults}>
          По умолчанию
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setColumns((prev) => [
              ...prev,
              {
                id: createExportColumnId(),
                title: "Столбец",
                fieldIds: [],
              },
            ])
          }
        >
          + Столбец
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--muted-fg)]">Загрузка…</p>
      ) : (
        <ExportColumnBuilder
          fields={fields}
          value={columns}
          onChange={setColumns}
          className={cn(mode === "short" && "max-w-full")}
        />
      )}

      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          disabled={!canExport || pending || loading}
          onClick={runExport}
        >
          {pending ? "Экспорт…" : "Экспортировать Excel"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Modal>
  );
}
