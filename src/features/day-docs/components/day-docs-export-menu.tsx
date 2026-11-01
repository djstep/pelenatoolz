"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { getCallSheetPrintHtmlAction } from "@/features/call-sheets/print-actions";
import { exportAttendanceSheetXlsxAction } from "@/features/day-docs/actions";
import {
  getAttendanceSheetSettingsAction,
  saveAttendanceSheetSettingsAction,
} from "@/features/exports/actions";
import {
  ATTENDANCE_BUILTIN_SECTIONS,
  attendanceCategorySectionId,
} from "@/features/exports/types";
import { printWhenImagesSettled } from "@/shared/lib/print-window";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Modal } from "@/shared/ui/modal";
import { PortaledMenu } from "@/shared/ui/portaled-menu";
import { useActionToast, useToast } from "@/shared/ui/toast";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBase64(base64: string, fileName: string, mimeType: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  downloadBlob(new Blob([bytes], { type: mimeType }), fileName);
}

/** Имя файла из `Content-Disposition`: сначала `filename*=UTF-8''…`, потом `filename="…"`. */
function fileNameFromDisposition(header: string | null, fallback: string) {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // битое имя — ниже запасное
    }
  }
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

/** Excel вызывного — файлом из маршрута; вход, право и день проверяет сервер. */
async function fetchCallSheetXlsx(
  projectId: string,
  dayId: string,
): Promise<{ blob: Blob; fileName: string } | { error: string }> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/call-sheets/${encodeURIComponent(dayId)}/xlsx`,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { error: body?.error ?? "Не удалось выгрузить Excel" };
  }
  // Вход истёк — вместо файла пришла страница входа.
  if (!res.headers.get("Content-Type")?.startsWith(XLSX_MIME)) {
    return { error: "Не удалось выгрузить Excel — обновите страницу и войдите снова" };
  }
  return {
    blob: await res.blob(),
    fileName: fileNameFromDisposition(res.headers.get("Content-Disposition"), "Вызывной.xlsx"),
  };
}

export type DayDocsExportResourceCategory = {
  id: string;
  name: string;
  perShift: boolean;
};

export function DayDocsExportMenu({
  projectId,
  dayId,
  resourceCategories,
  showCallSheetExports = true,
}: {
  projectId: string;
  dayId: string;
  resourceCategories: DayDocsExportResourceCategory[];
  showCallSheetExports?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error?: string; success?: string }>(
    {},
  );
  const triggerRef = useRef<HTMLSpanElement>(null);

  useActionToast(message);

  async function runDownload(
    key: string,
    action: () => Promise<
      { base64: string; fileName: string } | { error: string }
    >,
    mime: string,
    success: string,
  ) {
    setExporting(key);
    setOpen(false);
    try {
      const result = await action();
      if ("error" in result) {
        setMessage({ error: result.error });
        return;
      }
      downloadBase64(result.base64, result.fileName, mime);
      setMessage({ success });
    } finally {
      setExporting(null);
    }
  }

  /** Окно печати — как в кастинге: HTML с сервера → `document.write` → печать после фото и шрифтов. */
  async function printCallSheet() {
    setExporting("print");
    setOpen(false);
    try {
      const result = await getCallSheetPrintHtmlAction(projectId, dayId);
      if ("error" in result) {
        setMessage({ error: result.error });
        return;
      }
      const win = window.open("", "_blank");
      if (!win) {
        setMessage({ error: "Браузер не открыл окно печати — разрешите всплывающие окна" });
        return;
      }
      win.document.write(result.html);
      win.document.close();
      // Скрипты в странице печати запрещены (CSP) — печать вызывается отсюда.
      printWhenImagesSettled(win);
    } finally {
      setExporting(null);
    }
  }

  async function downloadCallSheetXlsx() {
    setExporting("xlsx");
    setOpen(false);
    try {
      const result = await fetchCallSheetXlsx(projectId, dayId);
      if ("error" in result) {
        setMessage({ error: result.error });
        return;
      }
      downloadBlob(result.blob, result.fileName);
      setMessage({ success: "Файл Excel сохранён" });
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      <span ref={triggerRef} className="inline-flex">
        <Button
          type="button"
          variant="secondary"
          disabled={exporting != null}
          onClick={() => setOpen((v) => !v)}
        >
          {exporting ? "Экспорт…" : "Экспорт ▾"}
        </Button>
      </span>
      <PortaledMenu
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        align="end"
        className="min-w-[14rem]"
      >
        {showCallSheetExports ? (
          <>
            <button
              type="button"
              className="glass-dropdown-item block w-full px-3 py-2 text-left text-sm"
              onClick={() => void printCallSheet()}
            >
              Печать / PDF
            </button>
            <button
              type="button"
              className="glass-dropdown-item block w-full px-3 py-2 text-left text-sm"
              onClick={() => void downloadCallSheetXlsx()}
            >
              Excel
            </button>
            <div className="my-1 border-t border-[var(--border)]" />
          </>
        ) : null}
        <button
          type="button"
          className="glass-dropdown-item block w-full px-3 py-2 text-left text-sm"
          onClick={() =>
            void runDownload(
              "attendance",
              () => exportAttendanceSheetXlsxAction(projectId, dayId),
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Явочный лист сохранён",
            )
          }
        >
          Явочный лист Excel
        </button>
        <button
          type="button"
          className="glass-dropdown-item block w-full px-3 py-2 text-left text-sm text-[var(--muted-fg)]"
          onClick={() => {
            setOpen(false);
            setSettingsOpen(true);
          }}
        >
          Настройка явочного листа…
        </button>
      </PortaledMenu>

      <AttendanceSheetSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        projectId={projectId}
        resourceCategories={resourceCategories}
      />
    </>
  );
}

function AttendanceSheetSettingsModal({
  open,
  onClose,
  projectId,
  resourceCategories,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  resourceCategories: DayDocsExportResourceCategory[];
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void getAttendanceSheetSettingsAction(projectId)
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          toast.error(res.error);
          return;
        }
        setSelected(new Set(res.attendanceSheet?.resourceIds ?? []));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, toast]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const res = await saveAttendanceSheetSettingsAction(
        projectId,
        Array.from(selected),
      );
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(res.success ?? "Сохранено");
      onClose();
    });
  }

  return (
    <Modal
      guardUnsaved
      open={open}
      onClose={onClose}
      title="Настройка явочного листа"
      footer={
        <div className="flex gap-2">
          <Button type="button" disabled={pending || loading} onClick={save}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-modal-cancel
            onClick={onClose}
          >
            Отмена
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-[var(--muted-fg)]">
          По умолчанию в выгрузку всегда входят вкладки «Актёры» и «Цеха»
          (участники группы из вызывного). Отметьте дополнительные ресурсы —
          каждый выбранный блок станет отдельной вкладкой Excel.
        </p>

        <div>
          <p className="mb-2 font-medium">Блоки сцены / вызывного</p>
          <ul className="space-y-2">
            {ATTENDANCE_BUILTIN_SECTIONS.map((s) => (
              <li key={s.id}>
                <Checkbox
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  disabled={loading}
                  label={s.label}
                />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-2 font-medium">Раздел «Ресурсы»</p>
          {resourceCategories.length === 0 ? (
            <p className="text-[var(--muted-fg)]">
              Категории ресурсов в проекте пока не созданы.
            </p>
          ) : (
            <ul className="space-y-2">
              {resourceCategories.map((c) => {
                const id = attendanceCategorySectionId(c.id);
                return (
                  <li key={c.id}>
                    <Checkbox
                      checked={selected.has(id)}
                      onChange={() => toggle(id)}
                      disabled={loading}
                      label={
                        <>
                          {c.name}
                          {c.perShift ? (
                            <span className="text-[var(--muted-fg)]">
                              {" "}
                              · посменно
                            </span>
                          ) : null}
                        </>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
