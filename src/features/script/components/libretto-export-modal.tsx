"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import {
  buildLibrettoExportFields,
  createDefaultExportColumns,
  librettoFieldLabelsMap,
} from "@/features/script/lib/libretto-fields";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/ui/modal";
import { useToast } from "@/shared/ui/toast";

export function LibrettoExportModal({
  open,
  onClose,
  onExport,
  projectId,
  tableResourceCategories = [],
  allResourceCategories = [],
}: {
  open: boolean;
  onClose: () => void;
  onExport: (
    columns: ExportColumn[],
    fieldLabels: Record<string, string>,
  ) => void | Promise<void>;
  projectId: string;
  /** Категории, видимые как столбцы таблицы (fillInScenes) */
  tableResourceCategories?: { id: string; name: string }[];
  /** Все категории из раздела «Ресурсы» */
  allResourceCategories?: { id: string; name: string }[];
}) {
  const toast = useToast();
  const [columns, setColumns] = useState<ExportColumn[]>(() =>
    createDefaultExportColumns(tableResourceCategories),
  );
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  const fields: ExportFieldDef[] = useMemo(
    () =>
      buildLibrettoExportFields(
        tableResourceCategories,
        allResourceCategories,
      ),
    [tableResourceCategories, allResourceCategories],
  );

  const fieldLabels = useMemo(() => librettoFieldLabelsMap(fields), [fields]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void getExportLayoutAction(projectId, "libretto").then((result) => {
      if (cancelled) return;
      if (result.layout?.columns?.length) {
        setColumns(result.layout.columns);
      } else {
        setColumns(createDefaultExportColumns(tableResourceCategories));
      }
      setLoading(false);
      if (result.error) toast.error(result.error);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const canExport = columns.some((col) => col.fieldIds.length > 0);

  function resetToTable() {
    setColumns(createDefaultExportColumns(tableResourceCategories));
  }

  function addEmptyColumn() {
    setColumns((prev) => [
      ...prev,
      { id: createExportColumnId(), title: "Столбец", fieldIds: [] },
    ]);
  }

  function runExport() {
    const ready = columnsReadyForExport(columns);
    if (ready.length === 0) return;
    startTransition(async () => {
      const save = await saveExportLayoutAction(projectId, "libretto", columns);
      if (save.error) toast.warning(save.error);
      await onExport(ready, fieldLabels);
      onClose();
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Настройки экспорта либретто"
      wide
    >
      <p className="mb-3 text-sm text-[var(--muted-fg)]">
        Столбцы Excel: поля таблицы либретто и ресурсы проекта. Перетаскивайте
        ресурсы между столбцами; «Доп. ресурсы» схлопывает заголовок в файле.
        Раскладка сохраняется в проекте.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={resetToTable}>
          Как в таблице
        </Button>
        <Button type="button" variant="secondary" onClick={addEmptyColumn}>
          + Столбец
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--muted-fg)]">Загрузка раскладки…</p>
      ) : (
        <ExportColumnBuilder
          fields={fields}
          value={columns}
          onChange={setColumns}
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
