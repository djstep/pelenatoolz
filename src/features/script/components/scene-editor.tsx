"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useSafeActionState } from "@/shared/ui/forms/use-safe-action-state";
import type { ProjectType } from "@prisma/client";
import {
  duplicateSceneAction,
  getSceneCutImpactAction,
  setSceneCutAction,
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
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { useFormGuard } from "@/shared/ui/unsaved/use-form-guard";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { useOnChange } from "@/shared/hooks/use-on-change";
import { cardPlaces, sceneLinkOf } from "@/features/script/lib/scene-locations";

const initial: ActionState = {};

/** Вариант выбора. У объектов: `shortName` — своё название, `parentId` — объект подобъекта. */
type Option = { id: string; name: string; shortName?: string; parentId?: string | null };

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
  isCut,
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
  isCut: boolean;
  prev: Neighbor | null;
  next: Neighbor | null;
  locations: Option[];
  characters: Option[];
  resourceCategories?: SceneCategoryOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const boundAction = updateSceneAction.bind(null, projectId, scene.id);
  const [state, action, pending] = useSafeActionState(boundAction, initial);
  const [dupPending, startDup] = useTransition();
  const [dupError, setDupError] = useState<string | null>(null);
  const [cutPending, startCut] = useTransition();
  const confirm = useConfirm();

  const [locations, setLocations] = useState(initialLocations);
  const [characters, setCharacters] = useState(initialCharacters);
  const [locationId, setLocationId] = useState(
    () => cardPlaces(scene.locations.map(sceneLinkOf)).objectId,
  );
  const [characterIds, setCharacterIds] = useState(
    () => scene.characters.map((c) => c.characterId) ?? [],
  );
  const [formKey, setFormKey] = useState(0);
  // Предупреждение о несохранённых изменениях при уходе со страницы.
  const { ref: formRef, markClean: markFormClean } = useFormGuard(canWrite, formKey, state);
  useActionSuccess(state, markFormClean);

  useOnChange([initialLocations], () => {
    setLocations(initialLocations);
  });

  useOnChange([initialCharacters], () => {
    setCharacters(initialCharacters);
  });

  useOnChange([scene], () => {
    setLocationId(cardPlaces(scene.locations.map(sceneLinkOf)).objectId);
    setCharacterIds(scene.characters.map((c) => c.characterId));
    setFormKey((k) => k + 1);
    setDupError(null);
  });

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

  function onCut() {
    setDupError(null);
    void confirm({
      title: `Вырезать сцену ${title}?`,
      details: () => getSceneCutImpactAction(projectId, scene.id),
      confirmLabel: "Вырезать",
      // Вырезанную сцену можно вернуть — действие обратимое.
      tone: "primary",
      action: async () => {
        const result = await setSceneCutAction(projectId, scene.id, "cut");
        if (result.error) return result.error;
        router.refresh();
      },
    });
  }

  function onRestore() {
    setDupError(null);
    startCut(async () => {
      const result = await setSceneCutAction(projectId, scene.id, "restore");
      if (result.error) setDupError(result.error);
      router.refresh();
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
              className="inline-flex items-center rounded-xl px-3 py-2 text-sm hover:bg-[rgb(var(--tint-rgb)/0.08)]"
            >
              ← {neighborLabel(prev)}
            </Link>
          ) : (
            <span className="px-2 text-sm text-[var(--muted-fg)]">←</span>
          )}
          <h1 className="font-display text-[27px] font-bold leading-tight px-2">
            Сцена <span className={isCut ? "line-through" : undefined}>{title}</span>
          </h1>
          {next ? (
            <Link
              href={`/${locale}/projects/${projectId}/libretto/${next.id}`}
              title={`Сцена ${neighborLabel(next)}`}
              className="inline-flex items-center rounded-xl px-3 py-2 text-sm hover:bg-[rgb(var(--tint-rgb)/0.08)]"
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
              {isCut ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={cutPending}
                  onClick={onRestore}
                >
                  {cutPending ? "…" : "Вернуть"}
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={onCut}>
                  Вырезать сцену
                </Button>
              )}
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

      {isCut ? (
        <p className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm text-[var(--muted-fg)]">
          Сцена вырезана: скрыта в либретто, не попадает в новые дни КПП и в итоги хронометража.
          История съёмок и отчёты смены не меняются.
        </p>
      ) : null}

      {(state.error || dupError) && (
        <p className="text-sm text-[var(--danger)]">
          {state.error ?? dupError}
        </p>
      )}
      {state.success ? (
        <p className="text-sm text-[var(--tone-success-strong)]">{state.success}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <form
          ref={formRef}
          key={formKey}
          id="scene-editor-form"
          className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-5"
          onSubmit={canWrite ? submitKeepingFields(action) : (e) => e.preventDefault()}
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
