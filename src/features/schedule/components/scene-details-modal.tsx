"use client";

import {
  dayNightLabels,
  intExtLabels,
  sceneStatusLabels,
} from "@/shared/i18n/domain-labels";
import { FormattedScriptContent } from "@/features/script/components/formatted-script-content";
import { Badge } from "@/shared/ui/badge";
import { Modal } from "@/shared/ui/modal";
import {
  formatPagesMinutes,
  formatSceneBrief,
} from "@/features/schedule/lib/day-summary";

export type SceneDetails = {
  id: string;
  number: string;
  postfix: string;
  episodeNumber: number;
  title: string | null;
  summary: string | null;
  scriptContent: string | null;
  planSeconds: number | null;
  pageCount: { toString(): string } | null;
  intExt: keyof typeof intExtLabels | null;
  dayNight: keyof typeof dayNightLabels | null;
  status: keyof typeof sceneStatusLabels | string;
  scriptDay: number | null;
  locations: { location: { name: string } }[];
  characters: { character: { id: string; name: string } }[];
};

export function SceneDetailsModal({
  scene,
  onClose,
}: {
  scene: SceneDetails | null;
  onClose: () => void;
}) {
  if (!scene) return null;

  const locations = scene.locations.map((l) => l.location.name).join(", ");
  const characters = scene.characters.map((c) => c.character.name).join(", ");
  const statusLabel =
    sceneStatusLabels[scene.status as keyof typeof sceneStatusLabels] ??
    scene.status;

  return (
    <Modal
      open={Boolean(scene)}
      onClose={onClose}
      title={formatSceneBrief(scene)}
      wide
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge>{statusLabel}</Badge>
          {scene.intExt ? <Badge>{intExtLabels[scene.intExt]}</Badge> : null}
          {scene.dayNight ? (
            <Badge>{dayNightLabels[scene.dayNight]}</Badge>
          ) : null}
          {scene.scriptDay != null ? (
            <Badge>День сценария #{scene.scriptDay}</Badge>
          ) : null}
        </div>

        <dl className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[var(--muted-fg)]">Хронометраж / объём</dt>
            <dd className="mt-0.5">
              {formatPagesMinutes(scene.pageCount, scene.planSeconds)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-fg)]">Объект</dt>
            <dd className="mt-0.5">{locations || "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-[var(--muted-fg)]">Персонажи</dt>
            <dd className="mt-0.5">{characters || "—"}</dd>
          </div>
          {scene.title ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--muted-fg)]">Название</dt>
              <dd className="mt-0.5">{scene.title}</dd>
            </div>
          ) : null}
          {scene.summary ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--muted-fg)]">Краткое содержание</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-[var(--muted-fg)]">
                {scene.summary}
              </dd>
            </div>
          ) : null}
        </dl>

        {scene.scriptContent ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-fg)]">
              Текст сцены
            </h3>
            <FormattedScriptContent
              content={scene.scriptContent}
              className="max-h-[40vh] overflow-y-auto"
            />
          </div>
        ) : (
          <p className="text-xs text-[var(--muted-fg)]">
            Текст сцены не загружен.
          </p>
        )}
      </div>
    </Modal>
  );
}
