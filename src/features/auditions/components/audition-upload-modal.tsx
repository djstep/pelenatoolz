"use client";

import { useMemo, useState } from "react";
import {
  createAuditionsBatchAction,
  type CreateAuditionPayload,
} from "@/features/auditions/actions";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

type PersonOpt = { id: string; label: string };
type CharacterOpt = { id: string; name: string };
type SceneOpt = {
  id: string;
  episodeNumber: number;
  number: string;
  postfix: string;
  title: string | null;
};

type ActorRow = { personId: string; characterId: string };

type DraftEntry = {
  key: string;
  file?: File;
  videoFileId?: string;
  uploadStatus: "idle" | "uploading" | "done" | "error";
  uploadError?: string;
  externalUrl: string;
  date: string;
  time: string;
  sceneId: string;
  isSelfTape: boolean;
  comment: string;
  actors: ActorRow[];
};

function sceneLabel(s: SceneOpt) {
  const num = s.postfix ? `${s.number}${s.postfix}` : s.number;
  const ep = s.episodeNumber > 0 ? `${s.episodeNumber}.` : "";
  return `${ep}${num}${s.title ? ` — ${s.title}` : ""}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptyEntry(presets?: {
  personId?: string;
  characterId?: string;
}): DraftEntry {
  return {
    key: crypto.randomUUID(),
    uploadStatus: "idle",
    externalUrl: "",
    date: todayIso(),
    time: "",
    sceneId: "",
    isSelfTape: false,
    comment: "",
    actors: [
      {
        personId: presets?.personId ?? "",
        characterId: presets?.characterId ?? "",
      },
    ],
  };
}

async function uploadVideo(projectId: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`/api/projects/${projectId}/uploads/video`, {
    method: "POST",
    body,
  });
  const data = (await res.json()) as {
    id?: string;
    error?: string;
  };
  if (!res.ok || !data.id) throw new Error(data.error ?? "Ошибка загрузки");
  return data.id;
}

export function AuditionUploadModal({
  projectId,
  open,
  onClose,
  people,
  characters,
  scenes,
  presetPersonId,
  presetCharacterId,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  people: PersonOpt[];
  characters: CharacterOpt[];
  scenes: SceneOpt[];
  presetPersonId?: string;
  presetCharacterId?: string;
}) {
  const toast = useToast();
  const [entries, setEntries] = useState<DraftEntry[]>(() => [
    emptyEntry({ personId: presetPersonId, characterId: presetCharacterId }),
  ]);
  const [saving, setSaving] = useState(false);

  const canSave = useMemo(
    () =>
      entries.every(
        (e) =>
          (e.videoFileId || e.externalUrl.trim()) &&
          e.date &&
          e.actors.some((a) => a.personId) &&
          e.uploadStatus !== "uploading",
      ),
    [entries],
  );

  function updateEntry(key: string, patch: Partial<DraftEntry>) {
    setEntries((prev) =>
      prev.map((e) => (e.key === key ? { ...e, ...patch } : e)),
    );
  }

  async function handleFilesPicked(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    const base = emptyEntry({
      personId: presetPersonId,
      characterId: presetCharacterId,
    });
    const next: DraftEntry[] = list.map((file, i) => ({
      ...base,
      key: crypto.randomUUID(),
      file,
      uploadStatus: "idle" as const,
      // keep first form fields if replacing single empty idle entry
      ...(i === 0 && entries.length === 1 && !entries[0]?.file
        ? {
            date: entries[0].date,
            time: entries[0].time,
            sceneId: entries[0].sceneId,
            isSelfTape: entries[0].isSelfTape,
            comment: entries[0].comment,
            actors: entries[0].actors,
            externalUrl: entries[0].externalUrl,
          }
        : {}),
    }));
    setEntries(next);

    for (const entry of next) {
      if (!entry.file) continue;
      updateEntry(entry.key, { uploadStatus: "uploading" });
      try {
        const id = await uploadVideo(projectId, entry.file);
        updateEntry(entry.key, {
          videoFileId: id,
          uploadStatus: "done",
        });
      } catch (err) {
        updateEntry(entry.key, {
          uploadStatus: "error",
          uploadError: err instanceof Error ? err.message : "Ошибка",
        });
      }
    }
  }

  function copyFirstToRest() {
    const first = entries[0];
    if (!first) return;
    setEntries((prev) =>
      prev.map((e, i) =>
        i === 0
          ? e
          : {
              ...e,
              date: first.date,
              time: first.time,
              sceneId: first.sceneId,
              isSelfTape: first.isSelfTape,
              comment: first.comment,
              actors: first.actors.map((a) => ({ ...a })),
              externalUrl: first.externalUrl,
            },
      ),
    );
    toast.success("Данные первого файла скопированы ниже");
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payloads: CreateAuditionPayload[] = entries.map((e) => ({
        videoFileId: e.videoFileId ?? null,
        externalUrl: e.externalUrl.trim() || null,
        date: e.date,
        time: e.time || null,
        sceneId: e.sceneId || null,
        isSelfTape: e.isSelfTape,
        comment: e.comment || null,
        actors: e.actors
          .filter((a) => a.personId)
          .map((a) => ({
            personId: a.personId,
            characterId: a.characterId || null,
          })),
      }));

      const result = await createAuditionsBatchAction(projectId, payloads);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Сохранено");
      onClose();
      setEntries([
        emptyEntry({
          personId: presetPersonId,
          characterId: presetCharacterId,
        }),
      ]);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось сохранить пробу",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Добавить пробы"
      wide
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave || saving}
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Видеофайлы</Label>
          <input
            type="file"
            accept="video/*"
            multiple
            className="mt-1 block w-full text-sm"
            onChange={(e) => void handleFilesPicked(e.target.files)}
          />
          <p className="mt-1 text-xs text-[var(--muted-fg)]">
            Можно выбрать несколько файлов. Кодирование идёт в фоне — форму
            можно закрыть после сохранения.
          </p>
        </div>

        {entries.length > 1 ? (
          <Button type="button" variant="secondary" onClick={copyFirstToRest}>
            Скопировать данные в файлы ниже
          </Button>
        ) : null}

        <div className="space-y-6">
          {entries.map((entry, index) => (
            <div
              key={entry.key}
              className="space-y-3 rounded-xl border border-[var(--border)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Файл {index + 1}
                  {entry.file ? `: ${entry.file.name}` : ""}
                </p>
                <span className="text-xs text-[var(--muted-fg)]">
                  {entry.uploadStatus === "uploading"
                    ? "Загрузка…"
                    : entry.uploadStatus === "done"
                      ? "Загружено (обработка в фоне)"
                      : entry.uploadStatus === "error"
                        ? entry.uploadError
                        : "Без файла — укажите ссылку"}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Дата съёмки пробы</Label>
                  <Input
                    type="date"
                    value={entry.date}
                    onChange={(e) =>
                      updateEntry(entry.key, { date: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Время (необязательно)</Label>
                  <Input
                    type="time"
                    value={entry.time}
                    onChange={(e) =>
                      updateEntry(entry.key, { time: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label>Сцена (необязательно)</Label>
                  <Select
                    value={entry.sceneId}
                    onChange={(e) =>
                      updateEntry(entry.key, { sceneId: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {scenes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {sceneLabel(s)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={entry.isSelfTape}
                      onChange={(e) =>
                        updateEntry(entry.key, {
                          isSelfTape: e.target.checked,
                        })
                      }
                    />
                    Самопроба
                  </label>
                </div>
              </div>

              <div>
                <Label>Внешняя ссылка (альтернатива загрузке)</Label>
                <Input
                  value={entry.externalUrl}
                  onChange={(e) =>
                    updateEntry(entry.key, { externalUrl: e.target.value })
                  }
                  placeholder="https://…"
                />
              </div>

              <div>
                <Label>Комментарий</Label>
                <Input
                  value={entry.comment}
                  onChange={(e) =>
                    updateEntry(entry.key, { comment: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Актёры / персонажи</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() =>
                      updateEntry(entry.key, {
                        actors: [
                          ...entry.actors,
                          {
                            personId: presetPersonId ?? "",
                            characterId: "",
                          },
                        ],
                      })
                    }
                  >
                    + участник
                  </Button>
                </div>
                {entry.actors.map((actor, ai) => (
                  <div key={ai} className="grid gap-2 sm:grid-cols-2">
                    <Select
                      value={actor.personId}
                      onChange={(e) => {
                        const actors = entry.actors.map((a, i) =>
                          i === ai ? { ...a, personId: e.target.value } : a,
                        );
                        updateEntry(entry.key, { actors });
                      }}
                    >
                      <option value="">Кандидат…</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={actor.characterId}
                      onChange={(e) => {
                        const actors = entry.actors.map((a, i) =>
                          i === ai
                            ? { ...a, characterId: e.target.value }
                            : a,
                        );
                        updateEntry(entry.key, { actors });
                      }}
                    >
                      <option value="">Без персонажа</option>
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
