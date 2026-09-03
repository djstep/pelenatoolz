"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { deleteAuditionAction } from "@/features/auditions/actions";
import {
  AuditionPlayerModal,
  AuditionThumb,
  type AuditionPlayerData,
} from "@/features/auditions/components/audition-player-modal";
import { AuditionFavoriteButton } from "@/features/auditions/components/audition-favorite-button";
import { AuditionUploadModal } from "@/features/auditions/components/audition-upload-modal";
import {
  auditionKindLabels,
  type AuditionFilters,
  type AuditionKind,
} from "@/features/auditions/lib/types";
import type { AuditionRow } from "@/features/auditions/queries";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
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

function sceneLabel(s: {
  episodeNumber: number;
  number: string;
  postfix: string;
  title: string | null;
}) {
  const num = s.postfix ? `${s.number}${s.postfix}` : s.number;
  const ep = s.episodeNumber > 0 ? `${s.episodeNumber}.` : "";
  return `${ep}${num}${s.title ? ` — ${s.title}` : ""}`;
}

function toPlayerData(row: AuditionRow): AuditionPlayerData {
  return {
    id: row.id,
    date: row.date,
    time: row.time,
    isSelfTape: row.isSelfTape,
    comment: row.comment,
    externalUrl: row.externalUrl,
    kind: row.kind,
    videoFile: row.videoFile
      ? {
          url: row.videoFile.url,
          originalName: row.videoFile.originalName,
          status: row.videoFile.status,
        }
      : null,
    scene: row.scene,
    actors: row.actors,
  };
}

export function AuditionsWorkspace({
  projectId,
  locale,
  auditions,
  people,
  characters,
  scenes,
  canWrite,
  initialFilters,
}: {
  projectId: string;
  locale: string;
  auditions: AuditionRow[];
  people: PersonOpt[];
  characters: CharacterOpt[];
  scenes: SceneOpt[];
  canWrite: boolean;
  initialFilters?: AuditionFilters;
}) {
  const toast = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [playing, setPlaying] = useState<AuditionPlayerData | null>(null);
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useState<AuditionFilters>({
    q: initialFilters?.q ?? "",
    personId: initialFilters?.personId ?? "",
    characterId: initialFilters?.characterId ?? "",
    sceneId: initialFilters?.sceneId ?? "",
    dateFrom: initialFilters?.dateFrom ?? "",
    dateTo: initialFilters?.dateTo ?? "",
    kind: initialFilters?.kind ?? "ALL",
    selfTape: initialFilters?.selfTape ?? "ALL",
  });

  const filtered = useMemo(() => {
    let rows = auditions;
    const q = filters.q?.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const blob = [
          r.comment ?? "",
          r.externalUrl ?? "",
          ...r.actorNames,
          ...r.actors.map((a) => a.character?.name ?? ""),
          r.scene ? sceneLabel(r.scene) : "",
        ]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
    }
    if (filters.personId) {
      rows = rows.filter((r) =>
        r.actors.some((a) => a.person.id === filters.personId),
      );
    }
    if (filters.characterId) {
      rows = rows.filter((r) =>
        r.actors.some((a) => a.character?.id === filters.characterId),
      );
    }
    if (filters.sceneId) {
      rows = rows.filter((r) => r.sceneId === filters.sceneId);
    }
    if (filters.dateFrom) {
      rows = rows.filter(
        (r) => new Date(r.date) >= new Date(filters.dateFrom!),
      );
    }
    if (filters.dateTo) {
      rows = rows.filter((r) => new Date(r.date) <= new Date(filters.dateTo!));
    }
    if (filters.kind && filters.kind !== "ALL") {
      rows = rows.filter((r) => r.kind === filters.kind);
    }
    if (filters.selfTape === "yes") {
      rows = rows.filter((r) => r.isSelfTape);
    }
    if (filters.selfTape === "no") {
      rows = rows.filter((r) => !r.isSelfTape);
    }
    return rows;
  }, [auditions, filters]);

  function remove(id: string) {
    if (!confirm("Удалить пробу?")) return;
    startTransition(async () => {
      const result = await deleteAuditionAction(projectId, id);
      if (result.error) toast.error(result.error);
      if (result.success) toast.success(result.success);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          <Button type="button" onClick={() => setUploadOpen(true)}>
            + Добавить пробу
          </Button>
        ) : null}
        <span className="text-sm text-[var(--muted-fg)]">
          {filtered.length} из {auditions.length}
        </span>
      </div>

      <div className="grid gap-3 rounded-xl border border-[var(--border)] p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-4">
          <Label>Поиск</Label>
          <Input
            value={filters.q ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Актёр, персонаж, сцена…"
          />
        </div>
        <div>
          <Label>Актёр</Label>
          <Select
            value={filters.personId ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, personId: e.target.value }))
            }
          >
            <option value="">Все</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Персонаж</Label>
          <Select
            value={filters.characterId ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, characterId: e.target.value }))
            }
          >
            <option value="">Все</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Тип</Label>
          <Select
            value={filters.kind ?? "ALL"}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                kind: e.target.value as AuditionKind | "ALL",
              }))
            }
          >
            <option value="ALL">Все</option>
            {(Object.keys(auditionKindLabels) as AuditionKind[]).map((k) => (
              <option key={k} value={k}>
                {auditionKindLabels[k]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Самопроба</Label>
          <Select
            value={filters.selfTape ?? "ALL"}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                selfTape: e.target.value as "yes" | "no" | "ALL",
              }))
            }
          >
            <option value="ALL">Все</option>
            <option value="yes">Да</option>
            <option value="no">Нет</option>
          </Select>
        </div>
        <div>
          <Label>Сцена</Label>
          <Select
            value={filters.sceneId ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, sceneId: e.target.value }))
            }
          >
            <option value="">Все</option>
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {sceneLabel(s)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Дата с</Label>
          <Input
            type="date"
            value={filters.dateFrom ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dateFrom: e.target.value }))
            }
          />
        </div>
        <div>
          <Label>Дата по</Label>
          <Input
            type="date"
            value={filters.dateTo ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dateTo: e.target.value }))
            }
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Проб пока нет.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="glass-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-3 py-2">Превью</th>
                <th className="px-3 py-2">★</th>
                <th className="px-3 py-2">Дата</th>
                <th className="px-3 py-2">Участники</th>
                <th className="px-3 py-2">Персонажи</th>
                <th className="px-3 py-2">Сцена</th>
                <th className="px-3 py-2">Тип</th>
                {canWrite ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--border)]/60 align-middle"
                >
                  <td className="px-3 py-2">
                    <AuditionThumb
                      onClick={() => setPlaying(toPlayerData(row))}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <AuditionFavoriteButton
                      projectId={projectId}
                      auditionId={row.id}
                      isFavorite={row.isFavorite}
                      canWrite={canWrite}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDateShort(row.date)}
                    {row.time ? ` · ${row.time}` : ""}
                    {row.isSelfTape ? (
                      <div className="text-xs text-[var(--muted-fg)]">
                        Самопроба
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <ul className="space-y-0.5">
                      {row.actors.map((a) => (
                        <li key={a.id}>
                          <Link
                            href={`/${locale}/projects/${projectId}/preproduction/casting/${a.person.id}`}
                            className="hover:text-[var(--accent)]"
                          >
                            {row.actorNames[
                              row.actors.findIndex((x) => x.id === a.id)
                            ] ?? a.person.lastName}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2 text-[var(--muted-fg)]">
                    {row.actors
                      .map((a) => a.character?.name)
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {row.scene ? sceneLabel(row.scene) : "—"}
                  </td>
                  <td className="px-3 py-2">{row.kindLabel}</td>
                  {canWrite ? (
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="danger"
                        disabled={pending}
                        onClick={() => remove(row.id)}
                      >
                        ×
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AuditionUploadModal
        projectId={projectId}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        people={people}
        characters={characters}
        scenes={scenes}
      />
      <AuditionPlayerModal
        audition={playing}
        onClose={() => setPlaying(null)}
      />
    </div>
  );
}
