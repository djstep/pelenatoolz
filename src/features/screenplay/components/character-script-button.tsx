"use client";

import { useState, useTransition } from "react";
import {
  exportCharacterScriptAction,
  type ActorScriptGrouping,
  type SingleActorScriptPayload,
} from "@/features/screenplay/lib/actor-script-export";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { useToast } from "@/shared/ui/toast";

interface Props {
  projectId: string;
  characterId: string;
  characterName: string;
  label?: string;
}

function downloadBase64(base64: string, fileName: string, mime: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
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
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
}

export function CharacterScriptButton({
  projectId,
  characterId,
  characterName,
  label = "Сценарий персонажа",
}: Props) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<"docx" | "pdf">("docx");
  const [grouping, setGrouping] = useState<ActorScriptGrouping>("script_order");
  const [episodeFrom, setEpisodeFrom] = useState("");
  const [episodeTo, setEpisodeTo] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();

  function handleExport() {
    start(async () => {
      const payload: SingleActorScriptPayload = {
        characterId,
        format,
        grouping,
        episodeRange:
          episodeFrom || episodeTo
            ? {
                from: episodeFrom ? parseInt(episodeFrom) : undefined,
                to: episodeTo ? parseInt(episodeTo) : undefined,
              }
            : undefined,
        dateRange:
          dateFrom || dateTo
            ? { from: dateFrom || undefined, to: dateTo || undefined }
            : undefined,
      };

      const result = await exportCharacterScriptAction(projectId, payload);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      setOpen(false);

      if (result.type === "single") {
        downloadBase64(result.base64, result.fileName, result.mime);
        toast.success("Файл сохранён");
      } else if (result.type === "single_html") {
        openPrintHtml(result.html);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={`Сценарий — ${characterName}`}>
        <div className="space-y-4 p-1">
          {/* Format */}
          <div className="flex gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="format"
                value="docx"
                checked={format === "docx"}
                onChange={() => setFormat("docx")}
              />
              Word (.docx)
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="format"
                value="pdf"
                checked={format === "pdf"}
                onChange={() => setFormat("pdf")}
              />
              PDF (печать)
            </label>
          </div>

          {/* Grouping */}
          <div>
            <Label>Порядок сцен</Label>
            <div className="mt-1 flex gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="grouping"
                  value="script_order"
                  checked={grouping === "script_order"}
                  onChange={() => setGrouping("script_order")}
                />
                По номерам (как в сценарии)
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="grouping"
                  value="shoot_date"
                  checked={grouping === "shoot_date"}
                  onChange={() => setGrouping("shoot_date")}
                />
                По датам съёмки (КПП)
              </label>
            </div>
          </div>

          {/* Episode range */}
          <div>
            <Label>Серии (необязательно)</Label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={1}
                placeholder="с"
                value={episodeFrom}
                onChange={(e) => setEpisodeFrom(e.target.value)}
                className="glass-input w-20 px-2 py-1 text-sm"
              />
              <span className="text-sm text-[var(--muted-fg)]">—</span>
              <input
                type="number"
                min={1}
                placeholder="по"
                value={episodeTo}
                onChange={(e) => setEpisodeTo(e.target.value)}
                className="glass-input w-20 px-2 py-1 text-sm"
              />
            </div>
          </div>

          {/* Date range */}
          <div>
            <Label>Даты съёмки по КПП (необязательно)</Label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="glass-input px-2 py-1 text-sm"
              />
              <span className="text-sm text-[var(--muted-fg)]">—</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="glass-input px-2 py-1 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={handleExport}
              disabled={pending}
            >
              {pending ? "Экспорт…" : "Экспортировать"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
