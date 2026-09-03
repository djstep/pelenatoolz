"use client";

import { useState } from "react";
import { AuditionScheduleWorkspace } from "@/features/auditions/components/audition-schedule-workspace";
import { AuditionsWorkspace } from "@/features/auditions/components/auditions-workspace";
import type { AuditionRow } from "@/features/auditions/queries";
import type {
  AuditionScheduleBreakRow,
  AuditionScheduleRow,
  ScheduleCandidateCard,
} from "@/features/auditions/lib/schedule-shared";
import { cn } from "@/shared/lib/cn";

type PersonOpt = { id: string; label: string };
type CharacterOpt = { id: string; name: string };
type SceneOpt = {
  id: string;
  episodeNumber: number;
  number: string;
  postfix: string;
  title: string | null;
};

export function AuditionsHub({
  projectId,
  locale,
  auditions,
  people,
  characters,
  scenes,
  scheduleCandidates,
  schedules,
  scheduleBreaks,
  canWrite,
}: {
  projectId: string;
  locale: string;
  auditions: AuditionRow[];
  people: PersonOpt[];
  characters: CharacterOpt[];
  scenes: SceneOpt[];
  scheduleCandidates: ScheduleCandidateCard[];
  schedules: AuditionScheduleRow[];
  scheduleBreaks: AuditionScheduleBreakRow[];
  canWrite: boolean;
}) {
  const [tab, setTab] = useState<"tapes" | "plan">("plan");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl border border-[var(--border)] p-1">
        <button
          type="button"
          className={cn(
            "flex-1 rounded-lg px-3 py-2 text-sm transition",
            tab === "plan"
              ? "bg-[var(--accent)]/20 font-medium text-[var(--foreground)]"
              : "text-[var(--muted-fg)] hover:text-[var(--foreground)]",
          )}
          onClick={() => setTab("plan")}
        >
          Планирование
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded-lg px-3 py-2 text-sm transition",
            tab === "tapes"
              ? "bg-[var(--accent)]/20 font-medium text-[var(--foreground)]"
              : "text-[var(--muted-fg)] hover:text-[var(--foreground)]",
          )}
          onClick={() => setTab("tapes")}
        >
          Записи проб
        </button>
      </div>

      {tab === "plan" ? (
        <AuditionScheduleWorkspace
          projectId={projectId}
          candidates={scheduleCandidates}
          schedules={schedules}
          breaks={scheduleBreaks}
          characters={characters}
          canWrite={canWrite}
        />
      ) : (
        <AuditionsWorkspace
          projectId={projectId}
          locale={locale}
          auditions={auditions}
          people={people}
          characters={characters}
          scenes={scenes}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}
