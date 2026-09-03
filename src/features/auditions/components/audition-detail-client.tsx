"use client";

import { useState } from "react";
import { AuditionFavoriteButton } from "@/features/auditions/components/audition-favorite-button";
import {
  AuditionPlayerModal,
  type AuditionPlayerData,
} from "@/features/auditions/components/audition-player-modal";
import { Button } from "@/shared/ui/button";

export function AuditionDetailClient({
  projectId,
  canWrite,
  audition,
}: {
  projectId: string;
  canWrite: boolean;
  audition: AuditionPlayerData & { isFavorite: boolean };
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <AuditionFavoriteButton
        projectId={projectId}
        auditionId={audition.id}
        isFavorite={audition.isFavorite}
        canWrite={canWrite}
      />
      <Button type="button" onClick={() => setPlaying(true)}>
        Смотреть пробу
      </Button>
      {audition.externalUrl ? (
        <a
          href={audition.externalUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          Внешняя ссылка
        </a>
      ) : null}
      <AuditionPlayerModal
        audition={playing ? audition : null}
        onClose={() => setPlaying(false)}
      />
    </div>
  );
}
