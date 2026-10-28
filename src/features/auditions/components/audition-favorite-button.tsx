"use client";

import { useTransition } from "react";
import { toggleAuditionFavoriteAction } from "@/features/casting/actions-cast-list-export";
import { cn } from "@/shared/lib/cn";
import { useToast } from "@/shared/ui/toast";

export function AuditionFavoriteButton({
  projectId,
  auditionId,
  isFavorite,
  canWrite,
}: {
  projectId: string;
  auditionId: string;
  isFavorite: boolean;
  canWrite: boolean;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={!canWrite || pending}
      title={isFavorite ? "Убрать из избранного" : "В избранное"}
      aria-label={isFavorite ? "Убрать из избранного" : "В избранное"}
      className={cn(
        "text-base leading-none",
        isFavorite ? "text-[var(--tone-warning-strong)]" : "text-[var(--muted)]",
        canWrite && "hover:text-[var(--tone-warning)]",
      )}
      onClick={() => {
        if (!canWrite) return;
        start(async () => {
          const r = await toggleAuditionFavoriteAction(projectId, auditionId);
          if (r.error) toast.error(r.error);
        });
      }}
    >
      {isFavorite ? "★" : "☆"}
    </button>
  );
}
