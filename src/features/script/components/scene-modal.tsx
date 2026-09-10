"use client";

import { useActionState, useEffect, useState } from "react";
import type { ProjectType, TimingMode } from "@prisma/client";
import {
  createSceneAction,
  type ActionState,
} from "@/features/script/actions";
import {
  SceneFormFields,
  type SceneEditData,
} from "@/features/script/components/scene-form-fields";
import type { SceneCategoryOption } from "@/features/script/components/scene-category-resource-block";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/ui/modal";

export type { SceneEditData };

const initial: ActionState = {};

type Option = { id: string; name: string };

/** Модалка только для создания сцены. Редактирование — на странице /libretto/[sceneId]. */
export function SceneModal({
  projectId,
  locale,
  projectType,
  shootOnFilm,
  timingMode: _timingMode = "MINUTES",
  pageToMinuteRatio: _pageToMinuteRatio = 1,
  open,
  onClose,
  locations: initialLocations,
  characters: initialCharacters,
  resourceCategories = [],
}: {
  projectId: string;
  locale: string;
  projectType: ProjectType;
  shootOnFilm: boolean;
  timingMode?: TimingMode;
  pageToMinuteRatio?: number;
  open: boolean;
  onClose: () => void;
  locations: Option[];
  characters: Option[];
  resourceCategories?: SceneCategoryOption[];
  /** @deprecated редактирование на отдельной странице */
  scene?: SceneEditData | null;
}) {
  const boundAction = createSceneAction.bind(null, projectId);
  const [state, action, pending] = useActionState(boundAction, initial);

  const [locations, setLocations] = useState(initialLocations);
  const [characters, setCharacters] = useState(initialCharacters);
  const [locationId, setLocationId] = useState("");
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    setLocations(initialLocations);
  }, [initialLocations]);

  useEffect(() => {
    setCharacters(initialCharacters);
  }, [initialCharacters]);

  useEffect(() => {
    if (!open) return;
    setLocationId("");
    setCharacterIds([]);
    setFormKey((k) => k + 1);
  }, [open]);

  useEffect(() => {
    if (state.success && !state.keepOpen) {
      onClose();
    }
    if (state.success && state.keepOpen) {
      setLocationId("");
      setCharacterIds([]);
      setFormKey((k) => k + 1);
    }
  }, [state.success, state.keepOpen, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Добавление сцены"
      wide
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" form="scene-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button
            type="submit"
            form="scene-form"
            name="recalcTiming"
            value="on"
            variant="secondary"
            disabled={pending}
          >
            Сохранить и пересчитать хрон.
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" name="createAnother" form="scene-form" />
            Создать ещё
          </label>
          {state.error ? (
            <span className="w-full text-sm text-[var(--danger)]">
              {state.error}
            </span>
          ) : null}
        </div>
      }
    >
      <form key={formKey} id="scene-form" action={action} className="space-y-5">
        <SceneFormFields
          projectId={projectId}
          locale={locale}
          projectType={projectType}
          shootOnFilm={shootOnFilm}
          locations={locations}
          setLocations={setLocations}
          characters={characters}
          setCharacters={setCharacters}
          locationId={locationId}
          setLocationId={setLocationId}
          characterIds={characterIds}
          setCharacterIds={setCharacterIds}
          resourceCategories={resourceCategories}
        />
      </form>
    </Modal>
  );
}
