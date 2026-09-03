"use client";

import { useEffect, useState, useTransition } from "react";
import { exportAuditionScheduleAction } from "@/features/auditions/actions-schedule-export";
import {
  defaultScheduleExportFields,
  scheduleExportFieldLabels,
  type ScheduleExportField,
} from "@/features/auditions/lib/export-schedule";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { useToast } from "@/shared/ui/toast";

function downloadBase64(base64: string, fileName: string, mime: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ScheduleExportModal({
  projectId,
  weekAnchorIso,
  dayKey,
  open,
  onClose,
}: {
  projectId: string;
  weekAnchorIso: string;
  dayKey?: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [scope, setScope] = useState<"week" | "all" | "day">(
    dayKey ? "day" : "week",
  );
  const [format, setFormat] = useState<"docx" | "pdf">("docx");
  const [fields, setFields] = useState<ScheduleExportField[]>(
    defaultScheduleExportFields,
  );

  useEffect(() => {
    if (open) setScope(dayKey ? "day" : "week");
  }, [open, dayKey]);

  function toggle(field: ScheduleExportField) {
    setFields((prev) =>
      prev.includes(field)
        ? prev.filter((f) => f !== field)
        : [...prev, field],
    );
  }

  function run() {
    if (scope === "day" && !dayKey) {
      toast.error("Откройте день в календаре для экспорта плана на день");
      return;
    }
    start(async () => {
      const result = await exportAuditionScheduleAction(projectId, {
        scope,
        weekAnchorIso,
        dayKey: dayKey ?? undefined,
        format,
        fields,
      });
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("base64" in result && result.base64) {
        downloadBase64(result.base64, result.fileName, result.mime);
        toast.success("Файл сохранён");
        onClose();
        return;
      }
      if ("html" in result && result.html) {
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(result.html);
          win.document.close();
        }
        toast.success("Открыто окно печати");
        onClose();
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Экспорт плана проб"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="button"
            disabled={pending || fields.length === 0}
            onClick={run}
          >
            {pending ? "…" : "Экспортировать"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Объём</Label>
          <div className="mt-1 flex flex-wrap gap-3 text-sm">
            {dayKey ? (
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={scope === "day"}
                  onChange={() => setScope("day")}
                />
                День · {formatDateShort(dayKey)}
              </label>
            ) : null}
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={scope === "week"}
                onChange={() => setScope("week")}
              />
              Текущая неделя
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={scope === "all"}
                onChange={() => setScope("all")}
              />
              Все запланированные
            </label>
          </div>
        </div>
        <div>
          <Label>Формат</Label>
          <div className="mt-1 flex gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={format === "docx"}
                onChange={() => setFormat("docx")}
              />
              Word
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={format === "pdf"}
                onChange={() => setFormat("pdf")}
              />
              PDF (печать)
            </label>
          </div>
        </div>
        <div>
          <Label>Поля</Label>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {(Object.keys(scheduleExportFieldLabels) as ScheduleExportField[]).map(
              (f) => (
                <label key={f} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={fields.includes(f)}
                    onChange={() => toggle(f)}
                  />
                  {scheduleExportFieldLabels[f]}
                </label>
              ),
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
