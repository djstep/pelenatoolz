"use client";

import { useMemo, useState, useTransition } from "react";
import { ExportColumnBuilder } from "@/features/exports/components/export-column-builder";
import { columnsReadyForExport, createExportColumnId } from "@/features/exports/lib/column-utils";
import type { ExportColumn } from "@/features/exports/types";
import { useStoredString } from "@/features/smeta/components/use-stored-string";
import { exportDepartmentBudgetAction } from "@/features/smeta/export-actions";
import { downloadBase64Xlsx } from "@/features/smeta/lib/download-xlsx";
import {
  SMETA_EXPORT_FIELDS,
  smetaDefaultExportColumns,
  smetaExportColumns,
} from "@/features/smeta/lib/items-export-columns";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/ui/modal";
import { useToast } from "@/shared/ui/toast";

const COLUMNS_KEY = "smeta-export-columns";

function storedColumns(raw: string | null): ExportColumn[] {
  if (!raw) return smetaDefaultExportColumns();
  try {
    return smetaExportColumns(JSON.parse(raw));
  } catch {
    return smetaDefaultExportColumns();
  }
}

/**
 * «Экспорт Excel» сметы цеха: окно с конструктором колонок (раскладка запоминается в браузере;
 * «Код» нужен, чтобы импорт потом обновил строки, но его можно убрать). Без `version` — утверждена →
 * последняя утверждённая, иначе черновик. `beforeExport` — досохранить правки главы (false — не
 * выгружать: в файл ушло бы не то, что на экране).
 */
export function BudgetExcelExportButton({
  projectId,
  departmentId,
  version,
  beforeExport,
  className,
}: {
  projectId: string;
  departmentId: string;
  version?: number;
  beforeExport?: () => Promise<boolean>;
  className?: string;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [stored, store] = useStoredString(COLUMNS_KEY);
  const saved = useMemo(() => storedColumns(stored), [stored]);
  const [columns, setColumns] = useState<ExportColumn[]>(saved);
  const fields = useMemo(() => SMETA_EXPORT_FIELDS.map(({ id, label }) => ({ id, label })), []);

  function runExport() {
    const ready = columnsReadyForExport(columns);
    if (ready.length === 0) return;
    start(async () => {
      if (beforeExport && !(await beforeExport())) {
        toast.error("Сначала должны сохраниться правки — Excel не выгружен");
        return;
      }
      store(JSON.stringify(ready));
      const res = await exportDepartmentBudgetAction(projectId, departmentId, { version, columns: ready });
      if (res.error !== undefined) {
        toast.error(res.error);
        return;
      }
      downloadBase64Xlsx(res.base64, res.fileName);
      toast.success("Excel скачан");
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className={className}
        disabled={pending}
        onClick={() => {
          setColumns(saved);
          setOpen(true);
        }}
      >
        {pending ? "…" : "Экспорт Excel"}
      </Button>
      {open ? (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Экспорт сметы в Excel"
          wide
          footer={
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending || columnsReadyForExport(columns).length === 0} onClick={runExport}>
                {pending ? "…" : "Экспортировать Excel"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Отмена
              </Button>
            </div>
          }
        >
          <p className="mb-3 text-sm text-[var(--muted-fg)]">
            Статьи, подстатьи и строки с итогами. Колонка «Код» нужна, чтобы после правки в Excel
            импорт обновил строки, а не добавил их заново; её можно убрать. Раскладка запоминается в
            этом браузере. Листы-черновики не выгружаются.
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => setColumns(smetaDefaultExportColumns())}>
              По умолчанию
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setColumns((prev) => [...prev, { id: createExportColumnId(), title: "Столбец", fieldIds: [] }])}
            >
              + Столбец
            </Button>
          </div>
          <ExportColumnBuilder fields={fields} value={columns} onChange={setColumns} allowExtrasBucket={false} />
        </Modal>
      ) : null}
    </>
  );
}
