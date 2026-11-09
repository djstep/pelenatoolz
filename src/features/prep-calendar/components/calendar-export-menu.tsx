"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { getExportLayoutAction, saveExportLayoutAction } from "@/features/exports/actions";
import { ExportColumnBuilder } from "@/features/exports/components/export-column-builder";
import { columnsReadyForExport, createExportColumnId } from "@/features/exports/lib/column-utils";
import { EXPORT_FAILED, EXPORT_LAYOUT_LOAD_FAILED } from "@/features/exports/lib/export-errors";
import { EXPORT_LAYOUT_NOT_SAVED_HINT, type ExportColumn } from "@/features/exports/types";
import { exportCalendarAction } from "@/features/prep-calendar/export-actions";
import {
  CALENDAR_EXPORT_FIELDS,
  CALENDAR_EXPORT_LAYOUT_KEY,
  calendarDefaultExportColumns,
  calendarExportColumns,
} from "@/features/prep-calendar/lib/calendar-export";
import type { DateRange } from "@/features/prep-calendar/lib/calendar-view";
import { printExport } from "@/shared/lib/print-window";
import { Button } from "@/shared/ui/button";
import { DateInput } from "@/shared/ui/date-input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { PortaledMenu } from "@/shared/ui/portaled-menu";
import { useToast } from "@/shared/ui/toast";

type Format = "xlsx" | "pdf";

function downloadBase64(base64: string, fileName: string, mime: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportModal({
  format,
  projectId,
  range,
  query,
  canSaveLayout,
  onClose,
}: {
  format: Format;
  projectId: string;
  range: DateRange;
  query: Record<string, string>;
  canSaveLayout: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [columns, setColumns] = useState<ExportColumn[]>(calendarDefaultExportColumns);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void getExportLayoutAction(projectId, CALENDAR_EXPORT_LAYOUT_KEY)
      .then((result) => {
        if (cancelled) return;
        const saved = calendarExportColumns(result.layout?.columns ?? []);
        if (saved.length > 0) setColumns(saved);
        setLoading(false);
        if (result.error) toast.error(result.error);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        toast.error(EXPORT_LAYOUT_LOAD_FAILED);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function runExport() {
    const ready = columnsReadyForExport(columns);
    if (ready.length === 0) return;
    const load = async () => {
      if (canSaveLayout) {
        const save = await saveExportLayoutAction(projectId, CALENDAR_EXPORT_LAYOUT_KEY, columns);
        if (save.error) toast.warning(save.error);
      }
      return exportCalendarAction(projectId, { format, columns: ready, from, to, query });
    };
    startTransition(async () => {
      if (format === "pdf") {
        // Окно открывается сразу по клику, до ответа сервера (блокировщик всплывающих окон).
        const printed = await printExport(load);
        if (printed.error) {
          toast.error(printed.error);
          return;
        }
        onClose();
        return;
      }
      try {
        const result = await load();
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        if ("base64" in result) {
          downloadBase64(result.base64, result.fileName, result.mime);
          toast.success("Файл сохранён");
          onClose();
        }
      } catch {
        toast.error(EXPORT_FAILED);
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={format === "pdf" ? "Печать списка событий" : "Экспорт событий в Excel"}
      wide
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={loading || pending || !from || !to || !columns.some((c) => c.fieldIds.length > 0)}
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
        Фильтры и переключатели экрана учитываются.{" "}
        {format === "pdf" ? "События сгруппированы по дням." : "Одна строка — одно событие."}
        {canSaveLayout ? " Раскладка колонок сохраняется в проекте." : null}
      </p>
      {canSaveLayout ? null : (
        <p className="mb-3 text-sm text-[var(--muted-fg)]">{EXPORT_LAYOUT_NOT_SAVED_HINT}</p>
      )}

      <div className="mb-3 grid gap-3 sm:grid-cols-[12rem_12rem_auto] sm:items-end">
        <div>
          <Label htmlFor="calendar-export-from">С</Label>
          <DateInput
            id="calendar-export-from"
            value={from}
            onChange={(change) => setFrom(change.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="calendar-export-to">По</Label>
          <DateInput
            id="calendar-export-to"
            value={to}
            onChange={(change) => setTo(change.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setColumns(calendarDefaultExportColumns())}>
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
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--muted-fg)]">Загрузка раскладки…</p>
      ) : (
        <ExportColumnBuilder
          fields={[...CALENDAR_EXPORT_FIELDS]}
          value={columns}
          onChange={setColumns}
          allowExtrasBucket={false}
        />
      )}
    </Modal>
  );
}

/**
 * «Экспорт»: Excel и печать списка за период через конструктор колонок. В недельном виде рядом
 * «Печать недели» — сразу, с раскладкой проекта.
 */
export function CalendarExportMenu({
  projectId,
  range,
  weekRange,
  query,
  canSaveLayout,
}: {
  projectId: string;
  /** Видимые дни: период по умолчанию. */
  range: DateRange;
  /** Неделя на экране — есть кнопка «Печать недели». */
  weekRange: DateRange | null;
  query: Record<string, string>;
  canSaveLayout: boolean;
}) {
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [format, setFormat] = useState<Format | null>(null);
  const [printing, startPrint] = useTransition();
  const anchorRef = useRef<HTMLSpanElement>(null);

  function choose(next: Format) {
    setFormat(next);
    setMenuOpen(false);
  }

  function printWeek() {
    if (!weekRange) return;
    startPrint(async () => {
      const printed = await printExport(() =>
        exportCalendarAction(projectId, {
          format: "pdf",
          columns: [],
          from: weekRange.from,
          to: weekRange.to,
          title: "week",
          query,
        }),
      );
      if (printed.error) toast.error(printed.error);
    });
  }

  return (
    <>
      {weekRange ? (
        <Button type="button" variant="secondary" disabled={printing} onClick={printWeek}>
          {printing ? "…" : "Печать недели"}
        </Button>
      ) : null}
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
        <ExportModal
          key={format}
          format={format}
          projectId={projectId}
          range={range}
          query={query}
          canSaveLayout={canSaveLayout}
          onClose={() => setFormat(null)}
        />
      ) : null}
    </>
  );
}
