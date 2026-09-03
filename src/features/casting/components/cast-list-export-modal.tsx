"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState, useTransition } from "react";
import { exportCastListAction } from "@/features/casting/actions-cast-list-export";
import { SortableFieldChecklist } from "@/features/casting/components/sortable-field-checklist";
import type { CastListExportBundleClient } from "@/features/casting/lib/cast-list-export-data";
import {
  CAST_LIST_ACTOR_FIELDS,
  CAST_LIST_CHARACTER_FIELDS,
  CAST_LIST_SORT_OPTIONS,
  DEFAULT_ACTOR_FIELD_IDS,
  DEFAULT_CHARACTER_FIELD_IDS,
  type CastListActorFieldId,
  type CastListCandidateExportConfig,
  type CastListCharacterFieldId,
  type CastListExportTapeItem,
  type CastListSort,
} from "@/features/casting/lib/cast-list-export-fields";
import { formatDateShort } from "@/shared/i18n/format-date";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { ImageUpload } from "@/shared/ui/image-upload";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
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

function newTapeId() {
  return `tape-${Math.random().toString(36).slice(2, 10)}`;
}

function SortableTapeRow({
  tape,
  label,
  onRemove,
}: {
  tape: CastListExportTapeItem;
  label: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: tape.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className="flex items-center gap-2 rounded-lg border border-[var(--border)]/60 px-2 py-1.5 text-xs"
    >
      <button
        type="button"
        className="cursor-grab px-1 text-[var(--muted-fg)]"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button
        type="button"
        className="text-[var(--muted-fg)] hover:text-[var(--danger)]"
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}

function CandidateExportSection({
  projectId,
  candidate,
  config,
  onChange,
}: {
  projectId: string;
  candidate: CastListExportBundleClient["candidates"][number];
  config: CastListCandidateExportConfig;
  onChange: (next: CastListCandidateExportConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [partnerQ, setPartnerQ] = useState("");
  const [extUrl, setExtUrl] = useState("");
  const [extNote, setExtNote] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const availableAuditions = useMemo(() => {
    const qq = partnerQ.trim().toLowerCase();
    return candidate.auditions.filter((a) => {
      if (favoritesOnly && !a.isFavorite) return false;
      if (!qq) return true;
      const blob = a.actors
        .map((x) => `${x.personLabel} ${x.characterName ?? ""}`)
        .join(" ")
        .toLowerCase();
      return blob.includes(qq) || a.kindLabel.toLowerCase().includes(qq);
    });
  }, [candidate.auditions, favoritesOnly, partnerQ]);

  const selectedAuditionIds = new Set(
    config.tapes.filter((t) => t.kind === "audition").map((t) => t.auditionId),
  );

  function patch(partial: Partial<CastListCandidateExportConfig>) {
    onChange({ ...config, ...partial });
  }

  function toggleComment(id: string) {
    const allIds = candidate.comments.map((c) => c.id);
    if (!config.commentsManual) {
      // First manual uncheck → switch to manual with all except this one
      patch({
        commentsManual: true,
        commentIds: allIds.filter((x) => x !== id),
      });
      return;
    }
    const set = new Set(config.commentIds ?? []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    patch({ commentIds: [...set] });
  }

  function isCommentChecked(id: string) {
    if (!config.commentsManual) return true;
    return (config.commentIds ?? []).includes(id);
  }

  function addAudition(auditionId: string) {
    if (selectedAuditionIds.has(auditionId)) return;
    patch({
      tapes: [
        ...config.tapes,
        { id: newTapeId(), kind: "audition", auditionId },
      ],
    });
  }

  function addExternal() {
    const url = extUrl.trim();
    if (!url) return;
    try {
      // validate
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      return;
    }
    patch({
      tapes: [
        ...config.tapes,
        {
          id: newTapeId(),
          kind: "external",
          url,
          note: extNote.trim(),
        },
      ],
    });
    setExtUrl("");
    setExtNote("");
  }

  function onTapeDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = config.tapes.findIndex((t) => t.id === active.id);
    const newIndex = config.tapes.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    patch({ tapes: arrayMove(config.tapes, oldIndex, newIndex) });
  }

  return (
    <div className="rounded-xl border border-[var(--border)]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{candidate.person.label}</span>
        <span className="text-xs text-[var(--muted-fg)]">
          {open ? "▴" : "▾"} · {candidate.statusLabel}
        </span>
      </button>
      {open ? (
        <div className="space-y-4 border-t border-[var(--border)] p-3">
          <div>
            <Label>Заглавное фото для выгрузки</Label>
            <p className="mb-1 text-[10px] text-[var(--muted-fg)]">
              Не меняет основное фото кандидата в системе
            </p>
            <ImageUpload
              projectId={projectId}
              name={`exportPhoto-${candidate.id}`}
              label="Фото для экспорта"
              value={config.photoOverrideUrl ?? ""}
              onChange={(url) =>
                patch({ photoOverrideUrl: url.trim() ? url : null })
              }
            />
            {candidate.person.photoUrl && !config.photoOverrideUrl ? (
              <p className="mt-1 text-[10px] text-[var(--muted-fg)]">
                Сейчас будет использовано основное фото
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Пробы</Label>
            <div className="flex flex-wrap gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={favoritesOnly}
                  onChange={(e) => setFavoritesOnly(e.target.checked)}
                />
                Только избранные
              </label>
              <Input
                value={partnerQ}
                onChange={(e) => setPartnerQ(e.target.value)}
                placeholder="Поиск по партнёру / персонажу…"
                className="max-w-xs text-xs"
              />
            </div>
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {availableAuditions.length === 0 ? (
                <p className="text-xs text-[var(--muted-fg)]">Нет проб</p>
              ) : (
                availableAuditions.map((a) => {
                  const partners = a.actors
                    .filter((x) => x.personId !== candidate.person.id)
                    .map((x) => x.personLabel)
                    .join(", ");
                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={selectedAuditionIds.has(a.id)}
                      onClick={() => addAudition(a.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg border border-[var(--border)]/50 px-2 py-1 text-left text-xs",
                        selectedAuditionIds.has(a.id)
                          ? "opacity-40"
                          : "hover:border-[var(--accent)]",
                      )}
                    >
                      <span>{a.isFavorite ? "★" : "☆"}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {a.kindLabel} · {formatDateShort(a.date)}
                        {partners ? ` · с ${partners}` : ""}
                      </span>
                      <span className="text-[var(--accent)]">+</span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                value={extUrl}
                onChange={(e) => setExtUrl(e.target.value)}
                placeholder="https://… внешняя ссылка"
              />
              <Input
                value={extNote}
                onChange={(e) => setExtNote(e.target.value)}
                placeholder="Примечание"
              />
              <Button type="button" variant="secondary" onClick={addExternal}>
                Добавить
              </Button>
            </div>
            {config.tapes.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onTapeDragEnd}
              >
                <SortableContext
                  items={config.tapes.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1">
                    {config.tapes.map((tape) => {
                      let label = "";
                      if (tape.kind === "audition") {
                        const a = candidate.auditions.find(
                          (x) => x.id === tape.auditionId,
                        );
                        label = a
                          ? `${a.kindLabel} · ${formatDateShort(a.date)}`
                          : "Проба";
                      } else {
                        label = tape.note || tape.url;
                      }
                      return (
                        <SortableTapeRow
                          key={tape.id}
                          tape={tape}
                          label={label}
                          onRemove={() =>
                            patch({
                              tapes: config.tapes.filter((t) => t.id !== tape.id),
                            })
                          }
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Комментарии</Label>
            {config.commentsManual ? (
              <p className="text-[10px] text-[var(--muted-fg)]">
                Режим ручного выбора: новые комментарии не попадут автоматически
              </p>
            ) : (
              <p className="text-[10px] text-[var(--muted-fg)]">
                По умолчанию включены все; снимите галку — новые не будут
                добавляться сами
              </p>
            )}
            {candidate.comments.length === 0 ? (
              <p className="text-xs text-[var(--muted-fg)]">Нет комментариев</p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {candidate.comments.map((cm) => (
                  <label
                    key={cm.id}
                    className="flex items-start gap-2 rounded-lg border border-[var(--border)]/40 px-2 py-1.5 text-xs"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={isCommentChecked(cm.id)}
                      onChange={() => toggleComment(cm.id)}
                    />
                    <span>
                      <span className="font-medium">
                        {cm.authorName}, {formatDateShort(cm.createdAt)}
                      </span>
                      <span className="mt-0.5 block text-[var(--muted-fg)]">
                        {cm.body}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CastListExportModal({
  projectId,
  locale,
  bundle,
  open,
  onClose,
}: {
  projectId: string;
  locale: string;
  bundle: CastListExportBundleClient;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [format, setFormat] = useState<"docx" | "pdf">("docx");
  const [sort, setSort] = useState<CastListSort>("nameAsc");
  const [characterFieldIds, setCharacterFieldIds] = useState<
    CastListCharacterFieldId[]
  >(DEFAULT_CHARACTER_FIELD_IDS);
  const [actorFieldIds, setActorFieldIds] = useState<CastListActorFieldId[]>(
    DEFAULT_ACTOR_FIELD_IDS,
  );
  const [configs, setConfigs] = useState<CastListCandidateExportConfig[]>(() =>
    bundle.candidates.map((c) => ({
      candidateId: c.id,
      photoOverrideUrl: null,
      tapes: [],
      commentIds: null,
      commentsManual: false,
    })),
  );

  function updateConfig(
    candidateId: string,
    next: CastListCandidateExportConfig,
  ) {
    setConfigs((prev) =>
      prev.map((c) => (c.candidateId === candidateId ? next : c)),
    );
  }

  function run() {
    start(async () => {
      const result = await exportCastListAction(projectId, {
        characterId: bundle.character.id,
        format,
        sort,
        characterFieldIds,
        actorFieldIds,
        candidateConfigs: configs,
        locale,
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
      title={`Каст-лист — ${bundle.character.name}`}
      wide
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="button" disabled={pending} onClick={run}>
            {pending ? "…" : "Экспортировать"}
          </Button>
        </div>
      }
    >
      <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
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
            <Label>Сортировка кандидатов</Label>
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as CastListSort)}
            >
              {CAST_LIST_SORT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label>Описание персонажа</Label>
          <p className="mb-2 text-xs text-[var(--muted-fg)]">
            Чекбоксы и порядок полей в шапке
          </p>
          <SortableFieldChecklist
            fields={CAST_LIST_CHARACTER_FIELDS}
            orderedIds={characterFieldIds}
            onChange={(ids) =>
              setCharacterFieldIds(ids as CastListCharacterFieldId[])
            }
          />
        </div>

        <div>
          <Label>Информация об актёрах</Label>
          <p className="mb-2 text-xs text-[var(--muted-fg)]">
            Поля карточки кандидата
          </p>
          <SortableFieldChecklist
            fields={CAST_LIST_ACTOR_FIELDS}
            orderedIds={actorFieldIds}
            onChange={(ids) => setActorFieldIds(ids as CastListActorFieldId[])}
          />
        </div>

        <div className="space-y-2">
          <Label>Кандидаты — пробы, комментарии, фото</Label>
          {bundle.candidates.map((c) => {
            const cfg = configs.find((x) => x.candidateId === c.id)!;
            return (
              <CandidateExportSection
                key={c.id}
                projectId={projectId}
                candidate={c}
                config={cfg}
                onChange={(next) => updateConfig(c.id, next)}
              />
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
