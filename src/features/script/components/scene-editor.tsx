"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import type { ProjectType } from "@prisma/client";
import {
  duplicateSceneAction,
  updateSceneAction,
  type ActionState,
} from "@/features/script/actions";
import {
  SceneFormFields,
  type SceneEditData,
} from "@/features/script/components/scene-form-fields";
import { ScenePlanningHistory } from "@/features/script/components/scene-planning-history";
import type { SceneCategoryOption } from "@/features/script/components/scene-category-resource-block";
import { formatSceneNumber } from "@/features/script/lib/libretto-display";
import { Button } from "@/shared/ui/button";

const initial: ActionState = {};

type Option = { id: string; name: string };

type Neighbor = {
  id: string;
  episodeNumber: number;
  number: string;
  postfix: string;
};

export function SceneEditor({
  projectId,
  locale,
  projectType,
  shootOnFilm,
  scene,
  prev,
  next,
  locations: initialLocations,
  characters: initialCharacters,
  resourceCategories = [],
  canWrite,
}: {
  projectId: string;
  locale: string;
  projectType: ProjectType;
  shootOnFilm: boolean;
  scene: SceneEditData;
  prev: Neighbor | null;
  next: Neighbor | null;
  locations: Option[];
  characters: Option[];
  resourceCategories?: SceneCategoryOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const boundAction = updateSceneAction.bind(null, projectId, scene.id);
  const [state, action, pending] = useActionState(boundAction, initial);
  const [dupPending, startDup] = useTransition();
  const [dupError, setDupError] = useState<string | null>(null);

  const [locations, setLocations] = useState(initialLocations);
  const [characters, setCharacters] = useState(initialCharacters);
  const [locationId, setLocationId] = useState(
    scene.locations[0]?.locationId ?? "",
  );
  const [characterIds, setCharacterIds] = useState(
    () => scene.characters.map((c) => c.characterId) ?? [],
  );
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    setLocations(initialLocations);
  }, [initialLocations]);

  useEffect(() => {
    setCharacters(initialCharacters);
  }, [initialCharacters]);

  useEffect(() => {
    setLocationId(scene.locations[0]?.locationId ?? "");
    setCharacterIds(scene.characters.map((c) => c.characterId));
    setFormKey((k) => k + 1);
    setDupError(null);
  }, [scene]);

  const title = formatSceneNumber(scene, projectType);
  const librettoHref = `/${locale}/projects/${projectId}/libretto`;

  function neighborLabel(n: Neighbor) {
    return formatSceneNumber(n, projectType);
  }

  function onDuplicate() {
    setDupError(null);
    startDup(async () => {
      const result = await duplicateSceneAction(projectId, scene.id);
      if (result.error) {
        setDupError(result.error);
        return;
      }
      if (result.newSceneId) {
        router.push(
          `/${locale}/projects/${projectId}/libretto/${result.newSceneId}`,
        );
      }
    });
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] pb-4">
        <Link
          href={librettoHref}
          className="glass-btn-secondary inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium"
        >
          ← Назад
        </Link>

        <div className="flex items-center gap-1">
          {prev ? (
            <Link
              href={`/${locale}/projects/${projectId}/libretto/${prev.id}`}
              title={`Сцена ${neighborLabel(prev)}`}
              className="inline-flex items-center rounded-xl px-3 py-2 text-sm hover:bg-white/8"
            >
              ← {neighborLabel(prev)}
            </Link>
          ) : (
            <span className="px-2 text-sm text-[var(--muted-fg)]">←</span>
          )}
          <h1 className="font-display px-2 text-xl font-semibold">
            Сцена {title}
          </h1>
          {next ? (
            <Link
              href={`/${locale}/projects/${projectId}/libretto/${next.id}`}
              title={`Сцена ${neighborLabel(next)}`}
              className="inline-flex items-center rounded-xl px-3 py-2 text-sm hover:bg-white/8"
            >
              {neighborLabel(next)} →
            </Link>
          ) : (
            <span className="px-2 text-sm text-[var(--muted-fg)]">→</span>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canWrite ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={dupPending}
                onClick={onDuplicate}
              >
                {dupPending ? "…" : "Повторить"}
              </Button>
              <Button type="submit" form="scene-editor-form" disabled={pending}>
                {pending ? "…" : "Сохранить"}
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {(state.error || dupError) && (
        <p className="text-sm text-[var(--danger)]">
          {state.error ?? dupError}
        </p>
      )}
      {state.success ? (
        <p className="text-sm text-green-400">{state.success}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <form
          key={formKey}
          id="scene-editor-form"
          action={canWrite ? action : undefined}
          className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5"
          onSubmit={(e) => {
            if (!canWrite) e.preventDefault();
          }}
        >
          <SceneFormFields
            projectId={projectId}
            locale={locale}
            projectType={projectType}
            shootOnFilm={shootOnFilm}
            scene={scene}
            locations={locations}
            setLocations={setLocations}
            characters={characters}
            setCharacters={setCharacters}
            locationId={locationId}
            setLocationId={setLocationId}
            characterIds={characterIds}
            setCharacterIds={setCharacterIds}
            resourceCategories={resourceCategories}
            readOnly={!canWrite}
          />
        </form>

        <ScenePlanningHistory
          locale={locale}
          projectId={projectId}
          attempts={scene.shootAttempts ?? []}
        />
      </div>
    </div>
  );
}
