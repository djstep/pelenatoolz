"use client";

import { useState } from "react";
import {
  AuditionPlayerModal,
  AuditionThumb,
  type AuditionPlayerData,
} from "@/features/auditions/components/audition-player-modal";
import { AuditionFavoriteButton } from "@/features/auditions/components/audition-favorite-button";
import { AuditionUploadModal } from "@/features/auditions/components/audition-upload-modal";
import type { AuditionRow } from "@/features/auditions/queries";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";

type PersonOpt = { id: string; label: string };
type CharacterOpt = { id: string; name: string };
type SceneOpt = {
  id: string;
  episodeNumber: number;
  number: string;
  postfix: string;
  title: string | null;
};

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

function sceneBrief(row: AuditionRow) {
  if (!row.scene) return null;
  const s = row.scene;
  const num = s.postfix ? `${s.number}${s.postfix}` : s.number;
  const ep = s.episodeNumber > 0 ? `${s.episodeNumber}.` : "";
  return `${ep}${num}`;
}

export function PersonAuditionsBlock({
  projectId,
  personId,
  personLabel,
  auditions,
  people,
  characters,
  scenes,
  canWrite,
  presetCharacterId,
}: {
  projectId: string;
  personId: string;
  personLabel: string;
  auditions: AuditionRow[];
  people: PersonOpt[];
  characters: CharacterOpt[];
  scenes: SceneOpt[];
  canWrite: boolean;
  presetCharacterId?: string;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [playing, setPlaying] = useState<AuditionPlayerData | null>(null);

  return (
    <section className="glass-card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Пробы</h2>
        {canWrite ? (
          <Button type="button" variant="secondary" onClick={() => setUploadOpen(true)}>
            Добавить пробу
          </Button>
        ) : null}
      </div>

      {auditions.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Проб пока нет</p>
      ) : (
        <ul className="space-y-2">
          {auditions.map((row) => {
            const chars = row.actors
              .map((a) => a.character?.name)
              .filter(Boolean)
              .join(", ");
            const scene = sceneBrief(row);
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <AuditionThumb onClick={() => setPlaying(toPlayerData(row))} />
                <AuditionFavoriteButton
                  projectId={projectId}
                  auditionId={row.id}
                  isFavorite={row.isFavorite}
                  canWrite={canWrite}
                />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">
                    {formatDateShort(row.date)}
                    {row.time ? ` · ${row.time}` : ""}
                    {row.isSelfTape ? (
                      <span className="ml-2 text-xs text-[var(--muted-fg)]">
                        Самопроба
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[var(--muted-fg)]">
                    {[chars || null, scene ? `сцена ${scene}` : null, row.kindLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AuditionUploadModal
        key={uploadOpen ? `open-${personId}` : "closed"}
        projectId={projectId}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        people={
          people.some((p) => p.id === personId)
            ? people
            : [{ id: personId, label: personLabel }, ...people]
        }
        characters={characters}
        scenes={scenes}
        presetPersonId={personId}
        presetCharacterId={presetCharacterId}
      />
      <AuditionPlayerModal
        audition={playing}
        onClose={() => setPlaying(null)}
      />
    </section>
  );
}
