"use client";

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
import type { ExportColumn } from "@/features/exports/types";
import {
  exportSceneScriptAction,
  type SceneScriptExportPayload,
} from "@/features/screenplay/actions";
import {
  buildDirectorScriptFields,
  createDefaultDirectorColumns,
} from "@/features/screenplay/lib/director-script-fields";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Modal } from "@/shared/ui/modal";
import { useToast } from "@/shared/ui/toast";

type Format = "docx" | "pdf";
type PdfPreset = "classic" | "crew";
type ContentMode = "full" | "summary";

function downloadBase64(base64: string, fileName: string, mime: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function openPrintHtml(html: string) {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
  return true;
}

function ScopeHint({
  selectedCount,
  filteredCount,
}: {
  selectedCount: number;
  filteredCount: number;
}) {
  if (selectedCount > 0) {
    return (
      <p className="mb-3 text-sm text-[var(--muted-fg)]">
        Будут экспортированы отмеченные сцены:{" "}
        <strong className="text-foreground">{selectedCount}</strong> из
        отфильтрованных {filteredCount}.
      </p>
    );
  }
  return (
    <p className="mb-3 text-sm text-[var(--muted-fg)]">
      Будут экспортированы сцены текущего фильтра:{" "}
      <strong className="text-foreground">{filteredCount}</strong>
      {filteredCount === 0 ? " (список пуст)" : ""}. Снимите фильтр или отметьте
      сцены чекбоксами.
    </p>
  );
}

function RegularScriptExportModal({
  open,
  onClose,
  projectId,
  sceneIds,
  selectedCount,
  filteredCount,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  sceneIds: string[];
  selectedCount: number;
  filteredCount: number;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [showCharacters, setShowCharacters] = useState(true);
  const [showExtras, setShowExtras] = useState(true);
  const [showGroup, setShowGroup] = useState(true);
  const [showEpisodeNumber, setShowEpisodeNumber] = useState(true);
  const [showProjectHeader, setShowProjectHeader] = useState(true);
  const [format, setFormat] = useState<Format>("docx");
  const [pdfPreset, setPdfPreset] = useState<PdfPreset>("classic");

  function run() {
    if (sceneIds.length === 0) {
      toast.error("Нет сцен для экспорта");
      return;
    }
    const payload: SceneScriptExportPayload = {
      sceneIds,
      format,
      mode: "regular",
      showCharacters,
      showExtras,
      showGroup,
      showEpisodeNumber,
      showProjectHeader,
      contentMode: "full",
      pdfPreset: format === "pdf" ? pdfPreset : "classic",
    };
    startTransition(async () => {
      const result = await exportSceneScriptAction(projectId, payload);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("base64" in result && result.base64) {
        downloadBase64(result.base64, result.fileName, result.mime);
        onClose();
        return;
      }
      if ("html" in result && result.html) {
        if (!openPrintHtml(result.html)) {
          toast.error("Разрешите всплывающие окна для печати PDF");
          return;
        }
        onClose();
      }
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Настройки экспорта сценария" wide>
      <ScopeHint selectedCount={selectedCount} filteredCount={filteredCount} />

      <div className="mb-4 space-y-2">
        <Checkbox
          checked={showCharacters}
          onChange={(e) => setShowCharacters(e.target.checked)}
          label="Показывать персонажей"
        />
        <Checkbox
          checked={showExtras}
          onChange={(e) => setShowExtras(e.target.checked)}
          label="Показывать массовку"
        />
        <Checkbox
          checked={showGroup}
          onChange={(e) => setShowGroup(e.target.checked)}
          label="Показывать групповку"
        />
        <Checkbox
          checked={showEpisodeNumber}
          onChange={(e) => setShowEpisodeNumber(e.target.checked)}
          label="Показ номера серии"
        />
        <Checkbox
          checked={showProjectHeader}
          onChange={(e) => setShowProjectHeader(e.target.checked)}
          label="Верхний колонтитул с названием проекта"
        />
      </div>

      <div className="mb-4 space-y-2">
        <p className="text-xs font-medium text-[var(--muted-fg)]">Формат</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="scriptFormat"
              checked={format === "docx"}
              onChange={() => setFormat("docx")}
            />
            Word
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="scriptFormat"
              checked={format === "pdf"}
              onChange={() => setFormat("pdf")}
            />
            PDF
          </label>
        </div>
        {format === "pdf" ? (
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="pdfPreset"
                checked={pdfPreset === "classic"}
                onChange={() => setPdfPreset("classic")}
              />
              Классический
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="pdfPreset"
                checked={pdfPreset === "crew"}
                onChange={() => setPdfPreset("crew")}
              />
              Для съёмочной группы (сцена с новой страницы)
            </label>
          </div>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button type="button" disabled={pending || sceneIds.length === 0} onClick={run}>
          {pending ? "Экспорт…" : "Экспортировать"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Modal>
  );
}

function DirectorScriptExportModal({
  open,
  onClose,
  projectId,
  sceneIds,
  selectedCount,
  filteredCount,
  resourceCategories,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  sceneIds: string[];
  selectedCount: number;
  filteredCount: number;
  resourceCategories: { id: string; name: string }[];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [columns, setColumns] = useState<ExportColumn[]>(() =>
    createDefaultDirectorColumns(resourceCategories),
  );
  const [contentMode, setContentMode] = useState<ContentMode>("full");
  const [showProjectHeader, setShowProjectHeader] = useState(true);
  const [format, setFormat] = useState<Format>("docx");
  const [pdfPreset, setPdfPreset] = useState<PdfPreset>("classic");

  const fields = useMemo(
    () => buildDirectorScriptFields(resourceCategories),
    [resourceCategories],
  );
  const fieldLabels = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.id, f.label])),
    [fields],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void getExportLayoutAction(projectId, "directorsScript").then((result) => {
      if (cancelled) return;
      if (result.layout?.columns?.length) {
        setColumns(result.layout.columns);
      } else {
        setColumns(createDefaultDirectorColumns(resourceCategories));
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, resourceCategories]);

  function run() {
    if (sceneIds.length === 0) {
      toast.error("Нет сцен для экспорта");
      return;
    }
    const ready = columnsReadyForExport(columns);
    startTransition(async () => {
      await saveExportLayoutAction(projectId, "directorsScript", columns);
      const result = await exportSceneScriptAction(projectId, {
        sceneIds,
        format,
        mode: "director",
        showCharacters: true,
        showExtras: true,
        showGroup: true,
        showEpisodeNumber: true,
        showProjectHeader,
        contentMode,
        pdfPreset: format === "pdf" ? pdfPreset : "classic",
        directorColumns: ready.length > 0 ? ready : columns,
        fieldLabels,
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("base64" in result && result.base64) {
        downloadBase64(result.base64, result.fileName, result.mime);
        onClose();
        return;
      }
      if ("html" in result && result.html) {
        if (!openPrintHtml(result.html)) {
          toast.error("Разрешите всплывающие окна для печати PDF");
          return;
        }
        onClose();
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Настройки экспорта · режиссёрский сценарий"
      wide
    >
      <ScopeHint selectedCount={selectedCount} filteredCount={filteredCount} />

      <div className="mb-4 space-y-2">
        <p className="text-xs font-medium text-[var(--muted-fg)]">Содержание</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="contentMode"
              checked={contentMode === "full"}
              onChange={() => setContentMode("full")}
            />
            Сценарий целиком
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="contentMode"
              checked={contentMode === "summary"}
              onChange={() => setContentMode("summary")}
            />
            Только краткое содержание
          </label>
        </div>
        <Checkbox
          checked={showProjectHeader}
          onChange={(e) => setShowProjectHeader(e.target.checked)}
          label="Верхний колонтитул с названием проекта"
        />
      </div>

      <div className="mb-4 space-y-2">
        <p className="text-xs font-medium text-[var(--muted-fg)]">Формат</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="dirFormat"
              checked={format === "docx"}
              onChange={() => setFormat("docx")}
            />
            Word
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="dirFormat"
              checked={format === "pdf"}
              onChange={() => setFormat("pdf")}
            />
            PDF
          </label>
        </div>
        {format === "pdf" ? (
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="dirPdfPreset"
                checked={pdfPreset === "classic"}
                onChange={() => setPdfPreset("classic")}
              />
              Классический
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="dirPdfPreset"
                checked={pdfPreset === "crew"}
                onChange={() => setPdfPreset("crew")}
              />
              Для съёмочной группы
            </label>
          </div>
        ) : null}
      </div>

      <p className="mb-2 text-sm text-[var(--muted-fg)]">
        Столбцы ресурсов в сцене (по умолчанию все в одном столбце):
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setColumns(createDefaultDirectorColumns(resourceCategories))
          }
        >
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
        <p className="mb-4 text-sm text-[var(--muted-fg)]">Загрузка раскладки…</p>
      ) : (
        <div className="mb-4">
          <ExportColumnBuilder
            fields={fields}
            value={columns}
            onChange={setColumns}
          />
        </div>
      )}

      <div className="flex gap-2">
        <Button type="button" disabled={pending || sceneIds.length === 0} onClick={run}>
          {pending ? "Экспорт…" : "Экспортировать"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Modal>
  );
}

export function LibrettoExportMenu({
  projectId,
  sceneIds,
  selectedCount,
  filteredCount,
  resourceCategories,
  onExcelExport,
}: {
  projectId: string;
  sceneIds: string[];
  selectedCount: number;
  filteredCount: number;
  resourceCategories: { id: string; name: string }[];
  onExcelExport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [directorOpen, setDirectorOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)}>
        Экспорт
      </Button>
      {open ? (
        <div className="glass-panel absolute left-0 top-full z-30 mt-1 min-w-[14rem] overflow-hidden rounded-xl py-1 shadow-lg">
          <button
            type="button"
            className="glass-dropdown-item block w-full px-3 py-2 text-left text-sm"
            onClick={() => {
              setOpen(false);
              onExcelExport();
            }}
          >
            Либретто (Excel)
          </button>
          <button
            type="button"
            className="glass-dropdown-item block w-full px-3 py-2 text-left text-sm"
            onClick={() => {
              setOpen(false);
              setScriptOpen(true);
            }}
          >
            Сценарий (Word/PDF)
          </button>
          <button
            type="button"
            className="glass-dropdown-item block w-full px-3 py-2 text-left text-sm"
            onClick={() => {
              setOpen(false);
              setDirectorOpen(true);
            }}
          >
            Режиссёрский сценарий
          </button>
        </div>
      ) : null}

      <RegularScriptExportModal
        open={scriptOpen}
        onClose={() => setScriptOpen(false)}
        projectId={projectId}
        sceneIds={sceneIds}
        selectedCount={selectedCount}
        filteredCount={filteredCount}
      />
      <DirectorScriptExportModal
        open={directorOpen}
        onClose={() => setDirectorOpen(false)}
        projectId={projectId}
        sceneIds={sceneIds}
        selectedCount={selectedCount}
        filteredCount={filteredCount}
        resourceCategories={resourceCategories}
      />
    </div>
  );
}
