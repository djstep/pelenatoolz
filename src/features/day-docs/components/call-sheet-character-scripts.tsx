"use client";

import { useRef, useState, useTransition } from "react";
import { exportMultiCharacterScriptsAction } from "@/features/screenplay/lib/actor-script-export";
import type { CastRow } from "@/features/day-docs/lib/build-day-doc";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/ui/modal";
import { PortaledMenu } from "@/shared/ui/portaled-menu";
import { useToast } from "@/shared/ui/toast";

type Format = "docx" | "pdf";

interface Props {
  projectId: string;
  cast: CastRow[];
  format: Format;
  onClose: () => void;
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

function CharacterScriptsModal({ projectId, cast, format, onClose }: Props) {
  const eligible = cast.filter((r) => r.characterId != null);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(eligible.map((r) => r.characterId!)),
  );
  const [pending, start] = useTransition();
  const toast = useToast();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === eligible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligible.map((r) => r.characterId!)));
    }
  }

  function handleExport() {
    start(async () => {
      const characterIds = [...selected];
      if (characterIds.length === 0) {
        toast.error("Выберите хотя бы одного персонажа");
        return;
      }

      const result = await exportMultiCharacterScriptsAction(projectId, {
        characterIds,
        format,
        grouping: "script_order",
      });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      onClose();

      if (result.type === "zip") {
        downloadBase64(result.base64, result.fileName, "application/zip");
        toast.success(`ZIP-архив с ${characterIds.length} сценариями сохранён`);
      }
    });
  }

  const title = format === "docx"
    ? "Сценарии по персонажам — Word"
    : "Сценарии по персонажам — PDF";

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-4 p-1">
        {eligible.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">
            Нет персонажей с назначенным ID в этот день.
          </p>
        ) : (
          <>
            <p className="text-xs text-[var(--muted-fg)]">
              Выберите персонажей — каждый получит отдельный файл,
              все файлы будут упакованы в один ZIP-архив.
            </p>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer border-b border-[var(--border)] pb-1 mb-1">
                <input
                  type="checkbox"
                  checked={selected.size === eligible.length}
                  onChange={toggleAll}
                />
                Все персонажи ({eligible.length})
              </label>
              {eligible.map((row) => (
                <label
                  key={row.characterId}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(row.characterId!)}
                    onChange={() => toggle(row.characterId!)}
                  />
                  <span>{row.characterName}</span>
                  {row.actorName && (
                    <span className="text-[var(--muted-fg)]">
                      ({row.actorName})
                    </span>
                  )}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={pending}
              >
                Отмена
              </Button>
              <Button
                type="button"
                onClick={handleExport}
                disabled={pending || selected.size === 0}
              >
                {pending
                  ? "Экспорт…"
                  : `Скачать ZIP (${selected.size})`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export function CallSheetCharacterScriptsMenu({
  projectId,
  cast,
}: {
  projectId: string;
  cast: CastRow[];
}) {
  const [modal, setModal] = useState<Format | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);

  return (
    <>
      <span ref={triggerRef} className="inline-flex">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setOpen((v) => !v)}
        >
          Сценарии ▾
        </Button>
      </span>
      <PortaledMenu
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        align="end"
        minWidth={220}
        className="py-1"
      >
        <button
          type="button"
          className="glass-dropdown-item w-full text-left text-sm"
          onClick={() => {
            setOpen(false);
            setModal("docx");
          }}
        >
          Сценарии по персонажам в Word
        </button>
        <button
          type="button"
          className="glass-dropdown-item w-full text-left text-sm"
          onClick={() => {
            setOpen(false);
            setModal("pdf");
          }}
        >
          Сценарии по персонажам в PDF
        </button>
      </PortaledMenu>

      {modal != null && (
        <CharacterScriptsModal
          projectId={projectId}
          cast={cast}
          format={modal}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
