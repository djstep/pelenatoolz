"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { exportCrewAction } from "@/features/crew/export-actions";
import {
  crewDefaultExportColumns,
  crewExportColumns,
  crewExportFields,
} from "@/features/crew/lib/crew-export";
import type { CrewRights } from "@/features/crew/lib/crew-rules";
import { getExportLayoutAction, saveExportLayoutAction } from "@/features/exports/actions";
import { ExportColumnBuilder } from "@/features/exports/components/export-column-builder";
import { columnsReadyForExport, createExportColumnId } from "@/features/exports/lib/column-utils";
import type { ExportColumn } from "@/features/exports/types";
import { printExport } from "@/shared/lib/print-window";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Modal } from "@/shared/ui/modal";
import { PortaledMenu } from "@/shared/ui/portaled-menu";
import { useToast } from "@/shared/ui/toast";

type CrewExportFormat = "xlsx" | "pdf";

const LAYOUT_KEY = "crew";

function downloadBase64(base64: string, fileName: string, mime: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function CrewExportModal({
  format,
  projectId,
  rights,
  canSaveLayout,
  onClose,
}: {
  format: CrewExportFormat;
  projectId: string;
  rights: CrewRights;
  canSaveLayout: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [columns, setColumns] = useState<ExportColumn[]>(() => crewDefaultExportColumns(rights));
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const fields = useMemo(() => crewExportFields(rights), [rights]);

  useEffect(() => {
    let cancelled = false;
    void getExportLayoutAction(projectId, LAYOUT_KEY).then((result) => {
      if (cancelled) return;
      const saved = crewExportColumns(result.layout?.columns ?? [], rights);
      if (saved.length > 0) setColumns(saved);
      setLoading(false);
      if (result.error) toast.error(result.error);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function runExport() {
    const ready = columnsReadyForExport(columns);
    if (ready.length === 0) return;
    const exportCrew = async () => {
      if (canSaveLayout) {
        const save = await saveExportLayoutAction(projectId, LAYOUT_KEY, columns);
        if (save.error) toast.warning(save.error);
      }
      return exportCrewAction(projectId, { format, columns: ready, includeArchived });
    };
    startTransition(async () => {
      if (format === "pdf") {
        // Окно открывается сразу по клику, до ответа сервера (блокировщик всплывающих окон).
        const printed = await printExport(exportCrew);
        if (printed.error) {
          toast.error(printed.error);
          return;
        }
        onClose();
        return;
      }
      const result = await exportCrew();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if ("base64" in result) {
        downloadBase64(result.base64, result.fileName, result.mime);
        toast.success("Файл сохранён");
        onClose();
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={format === "pdf" ? "Печать списка команды" : "Экспорт команды в Excel"}
      wide
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={loading || pending || !columns.some((c) => c.fieldIds.length > 0)}
            onClick={runExport}
          >
            {pending ? "…" : format === "pdf" ? "Печать" : "Экспортировать Excel"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-[var(--muted-fg)]">
        {format === "pdf"
          ? "Люди сгруппированы по цехам, цех — заголовок группы."
          : "Строки идут по цехам, как на экране."}{" "}
        Экспорт идёт по всей команде: поиск и фильтр цеха не учитываются.
        {canSaveLayout ? " Раскладка сохраняется в проекте." : null}
      </p>
      {canSaveLayout ? null : (
        <p className="mb-3 text-sm text-[var(--muted-fg)]">
          Настройки колонок не сохранятся: сохраняет тот, кому доступны все колонки
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => setColumns(crewDefaultExportColumns(rights))}>
          По умолчанию
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setColumns((prev) => [...prev, { id: createExportColumnId(), title: "Столбец", fieldIds: [] }])
          }
        >
          + Столбец
        </Button>
        <Checkbox
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
          label="Включить людей из архива"
        />
      </div>

      {loading ? (
        <p className="text-sm text-[var(--muted-fg)]">Загрузка раскладки…</p>
      ) : (
        <ExportColumnBuilder
          fields={fields}
          value={columns}
          onChange={setColumns}
          allowExtrasBucket={false}
        />
      )}
    </Modal>
  );
}

/** «Экспорт»: Excel и печать через один конструктор колонок. Кнопка видна всем с просмотром команды. */
export function CrewExportMenu({
  projectId,
  rights,
  canSaveLayout,
}: {
  projectId: string;
  rights: CrewRights;
  canSaveLayout: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [format, setFormat] = useState<CrewExportFormat | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  function choose(next: CrewExportFormat) {
    setFormat(next);
    setMenuOpen(false);
  }

  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        <Button type="button" variant="secondary" onClick={() => setMenuOpen((v) => !v)}>
          Экспорт
        </Button>
      </span>
      <PortaledMenu
        open={menuOpen}
        anchorRef={anchorRef}
        onClose={() => setMenuOpen(false)}
        role="menu"
        align="end"
        minWidth={176}
        className="py-1"
      >
        <button
          type="button"
          role="menuitem"
          className="glass-dropdown-item block w-full px-3 py-2 text-left text-sm"
          onClick={() => choose("xlsx")}
        >
          Excel
        </button>
        <button
          type="button"
          role="menuitem"
          className="glass-dropdown-item block w-full px-3 py-2 text-left text-sm"
          onClick={() => choose("pdf")}
        >
          Печать
        </button>
      </PortaledMenu>
      {format ? (
        <CrewExportModal
          key={format}
          format={format}
          projectId={projectId}
          rights={rights}
          canSaveLayout={canSaveLayout}
          onClose={() => setFormat(null)}
        />
      ) : null}
    </>
  );
}
