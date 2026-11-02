"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  downloadBlob,
  fetchCallSheetXlsx,
  printCallSheet as openCallSheetPrint,
} from "@/features/call-sheets/components/call-sheet-print-client";
import { CallSheetDriveExportModal } from "@/features/call-sheets/components/call-sheet-drive-export-modal";
import { exportAttendanceSheetXlsxAction } from "@/features/day-docs/actions";
import {
  getAttendanceSheetSettingsAction,
  saveAttendanceSheetSettingsAction,
} from "@/features/exports/actions";
import {
  ATTENDANCE_BUILTIN_SECTIONS,
  attendanceCategorySectionId,
} from "@/features/exports/types";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Modal } from "@/shared/ui/modal";
import { PortaledMenu } from "@/shared/ui/portaled-menu";
import { useActionToast, useToast } from "@/shared/ui/toast";

function downloadBase64(base64: string, fileName: string, mimeType: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  downloadBlob(new Blob([bytes], { type: mimeType }), fileName);
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
  canSaveAttendanceSettings,
}: {
  projectId: string;
  dayId: string;
  resourceCategories: DayDocsExportResourceCategory[];
  showCallSheetExports?: boolean;
  /** Сохранение настройки явочного листа — правка «КПП и вызывные» (`ATTENDANCE_SHEET_WRITE_PERMISSION`). */
  canSaveAttendanceSettings: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
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
      const result = await openCallSheetPrint(projectId, dayId);
      if (result.error) setMessage({ error: result.error });
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
      <span className="inline-flex gap-2">
        <span ref={triggerRef} className="inline-flex">
          <Button
            type="button"
            variant="secondary"
            disabled={exporting != null}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {exporting ? "Экспорт…" : "Экспорт ▾"}
          </Button>
        </span>
        <Button
          type="button"
          variant="secondary"
          className="px-3"
          title="Настройка явочного листа"
          aria-label="Настройка явочного листа"
          onClick={() => setSettingsOpen(true)}
        >
          <GearIcon />
        </Button>
      </span>
      <PortaledMenu
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        align="end"
        role="menu"
        className="p-1"
      >
        {showCallSheetExports ? (
          <MenuGroup label="Вызывной лист">
            <MenuItem onClick={() => void printCallSheet()}>Печать / PDF</MenuItem>
            <MenuItem onClick={() => void downloadCallSheetXlsx()}>Excel</MenuItem>
            <MenuItem
              onClick={() => {
                setOpen(false);
                setDriveOpen(true);
              }}
            >
              На диск…
            </MenuItem>
          </MenuGroup>
        ) : null}
        <MenuGroup label="Явочный лист">
          <MenuItem
            onClick={() =>
              void runDownload(
                "attendance",
                () => exportAttendanceSheetXlsxAction(projectId, dayId),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Явочный лист сохранён",
              )
            }
          >
            Excel
          </MenuItem>
        </MenuGroup>
      </PortaledMenu>

      {showCallSheetExports && driveOpen ? (
        <CallSheetDriveExportModal
          open
          onClose={() => setDriveOpen(false)}
          projectId={projectId}
          dayId={dayId}
        />
      ) : null}

      <AttendanceSheetSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        projectId={projectId}
        resourceCategories={resourceCategories}
        canSave={canSaveAttendanceSettings}
      />
    </>
  );
}

/** Группа меню выгрузок: подпись и пункты. Ширина меню — по самому длинному пункту. */
function MenuGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="border-t border-[var(--border)] py-1 first:border-t-0">
      <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-fg)] whitespace-nowrap">
        {label}
      </div>
      {children}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="glass-dropdown-item whitespace-nowrap pl-4 text-left text-sm"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M7.84 1.8A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.8l.28 1.4c.48.2.93.46 1.35.77l1.36-.46a1 1 0 0 1 1.18.45l1.18 2.04a1 1 0 0 1-.2 1.25l-1.07.95a6.1 6.1 0 0 1 0 1.56l1.07.95a1 1 0 0 1 .2 1.25l-1.18 2.04a1 1 0 0 1-1.18.45l-1.36-.46c-.42.31-.87.57-1.35.77l-.28 1.4a1 1 0 0 1-.98.8H8.82a1 1 0 0 1-.98-.8l-.28-1.4a6 6 0 0 1-1.35-.77l-1.36.46a1 1 0 0 1-1.18-.45L2.49 13.4a1 1 0 0 1 .2-1.25l1.07-.95a6.1 6.1 0 0 1 0-1.56l-1.07-.95a1 1 0 0 1-.2-1.25l1.18-2.04a1 1 0 0 1 1.18-.45l1.36.46c.42-.31.87-.57 1.35-.77l.28-1.4ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function AttendanceSheetSettingsModal({
  open,
  onClose,
  projectId,
  resourceCategories,
  canSave,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  resourceCategories: DayDocsExportResourceCategory[];
  canSave: boolean;
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
          {canSave ? (
            <Button type="button" disabled={pending || loading} onClick={save}>
              {pending ? "…" : "Сохранить"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            data-modal-cancel
            onClick={onClose}
          >
            {canSave ? "Отмена" : "Закрыть"}
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
        {canSave ? null : (
          <p className="text-[var(--muted-fg)]">
            Только просмотр: менять настройку может участник с правкой «КПП и вызывные».
            Явочный лист выгружается по этим настройкам.
          </p>
        )}

        <div>
          <p className="mb-2 font-medium">Блоки сцены / вызывного</p>
          <ul className="space-y-2">
            {ATTENDANCE_BUILTIN_SECTIONS.map((s) => (
              <li key={s.id}>
                <Checkbox
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  disabled={loading || !canSave}
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
                      disabled={loading || !canSave}
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
