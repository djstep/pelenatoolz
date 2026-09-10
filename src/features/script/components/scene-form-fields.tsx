"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ElementType,
  ProjectType,
  SceneKind,
  SceneResourceCategory,
  SceneStatus,
  type DayNight,
  type IntExt,
  type ProductionSceneFactStatus,
} from "@prisma/client";
import { quickCreateLocationAction } from "@/features/locations/actions";
import { loadScreenplayBlocksAction } from "@/features/screenplay/actions";
import { quickCreateCharacterAction } from "@/features/script/actions";
import {
  SceneResourceBlock,
  TagMultiField,
} from "@/features/script/components/scene-resource-blocks";
import {
  SceneCategoryResourceBlock,
  type SceneCategoryOption,
} from "@/features/script/components/scene-category-resource-block";
import {
  dayNightLabels,
  formatSecondsMmSs,
  intExtLabels,
  sceneKindLabels,
} from "@/shared/i18n/domain-labels";
import {
  CreatableMultiSelect,
  CreatableSelect,
} from "@/shared/ui/creatable-select";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";

export type SceneEditData = {
  id: string;
  episodeNumber: number;
  number: string;
  postfix: string;
  title: string | null;
  summary: string | null;
  description: string | null;
  scriptContent: string | null;
  scriptDay: number | null;
  objectType: string | null;
  sceneKind: SceneKind;
  shootingUnit: string | null;
  montageMap: string | null;
  pageCount: { toString(): string } | null;
  planSeconds: number | null;
  factSeconds: number | null;
  preEditSeconds: number | null;
  editSeconds: number | null;
  filmFootagePlan: { toString(): string } | null;
  filmFootageFact: { toString(): string } | null;
  intExt: IntExt | null;
  dayNight: DayNight | null;
  status: SceneStatus;
  locations: { locationId: string; location: { id: string; name: string } }[];
  characters: { characterId: string; character: { id: string; name: string } }[];
  elements: {
    element: { id: string; name: string; type: ElementType };
  }[];
  resources: Array<{
    category: SceneResourceCategory;
    name: string;
    quantity: number;
    unitPrice: { toString(): string } | number;
  }>;
  resourceItems?: Array<{
    itemId: string;
    quantity: number;
    item: {
      id: string;
      name: string;
      category: { id: string; name: string };
    };
  }>;
  shootAttempts?: Array<{
    id: string;
    shootDate: string | Date;
    status: ProductionSceneFactStatus;
    shootDay: { id: string; dayNumber: number; unit: string | null };
  }>;
};

type Option = { id: string; name: string };

function timingValue(seconds: number | null | undefined) {
  if (seconds == null) return "";
  const label = formatSecondsMmSs(seconds);
  return label === "—" ? "" : label;
}

function decimalValue(value: { toString(): string } | null | undefined) {
  if (value == null) return "";
  return value.toString();
}

function resourcesFor(
  scene: SceneEditData | null | undefined,
  category: SceneResourceCategory,
) {
  if (!scene) return undefined;
  return scene.resources
    .filter((r) => r.category === category)
    .map((r) => ({
      name: r.name,
      quantity: r.quantity,
      unitPrice: Number(r.unitPrice) || 0,
    }));
}

function tagsFor(scene: SceneEditData | null | undefined, type: ElementType) {
  if (!scene) return [];
  return scene.elements
    .filter((e) => e.element.type === type)
    .map((e) => e.element.name);
}

function resourceItemsForCategory(
  scene: SceneEditData | null | undefined,
  categoryId: string,
) {
  if (!scene?.resourceItems) return [];
  return scene.resourceItems
    .filter((l) => l.item.category.id === categoryId)
    .map((l) => ({ itemId: l.itemId, quantity: l.quantity }));
}

export function SceneFormFields({
  projectId,
  locale,
  projectType,
  shootOnFilm,
  scene = null,
  locations,
  setLocations,
  characters,
  setCharacters,
  locationId,
  setLocationId,
  characterIds,
  setCharacterIds,
  resourceCategories = [],
  readOnly = false,
}: {
  projectId: string;
  locale: string;
  projectType: ProjectType;
  shootOnFilm: boolean;
  scene?: SceneEditData | null;
  locations: Option[];
  setLocations: React.Dispatch<React.SetStateAction<Option[]>>;
  characters: Option[];
  setCharacters: React.Dispatch<React.SetStateAction<Option[]>>;
  locationId: string;
  setLocationId: (id: string) => void;
  characterIds: string[];
  setCharacterIds: (ids: string[]) => void;
  resourceCategories?: SceneCategoryOption[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const isEdit = Boolean(scene);
  const isSeries = projectType === ProjectType.SERIES;
  const [loadingScript, setLoadingScript] = useState(false);

  return (
    <fieldset disabled={readOnly} className="min-w-0 space-y-5 border-0 p-0">
      <div className="grid gap-4 md:grid-cols-3">
        {isSeries ? (
          <div>
            <Label htmlFor="episodeNumber">Серия *</Label>
            <Input
              id="episodeNumber"
              name="episodeNumber"
              type="number"
              min={1}
              required
              defaultValue={scene?.episodeNumber || ""}
            />
          </div>
        ) : null}
        <div>
          <Label htmlFor="number">Номер *</Label>
          <Input
            id="number"
            name="number"
            required
            defaultValue={scene?.number ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="postfix">Постфикс</Label>
          <Input
            id="postfix"
            name="postfix"
            placeholder="A"
            defaultValue={scene?.postfix ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="sceneKind">Тип</Label>
          <Select
            id="sceneKind"
            name="sceneKind"
            defaultValue={scene?.sceneKind ?? SceneKind.SCENE}
          >
            {Object.entries(sceneKindLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="shootingUnit">Съёмочная группа</Label>
          <Input
            id="shootingUnit"
            name="shootingUnit"
            placeholder="Первая, вторая…"
            defaultValue={scene?.shootingUnit ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Локация *</Label>
          <CreatableSelect
            name="locationId"
            options={locations}
            value={locationId}
            required
            onChange={setLocationId}
            onCreate={async (name) => {
              const result = await quickCreateLocationAction(projectId, name);
              if ("id" in result) {
                setLocations((prev) =>
                  prev.some((l) => l.id === result.id)
                    ? prev
                    : [...prev, result],
                );
              }
              return result;
            }}
          />
        </div>
        <div>
          <Label htmlFor="objectType">Тип объекта</Label>
          <Input
            id="objectType"
            name="objectType"
            defaultValue={scene?.objectType ?? ""}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="scriptDay">Сценарный день</Label>
          <Input
            id="scriptDay"
            name="scriptDay"
            type="number"
            min={0}
            defaultValue={scene?.scriptDay ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="dayNight">Режим</Label>
          <Select
            id="dayNight"
            name="dayNight"
            defaultValue={scene?.dayNight ?? ""}
          >
            <option value="">—</option>
            {Object.entries(dayNightLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <Label>Персонажи</Label>
        <CreatableMultiSelect
          name="characterIds"
          options={characters}
          value={characterIds}
          onChange={setCharacterIds}
          onCreate={async (name) => {
            const result = await quickCreateCharacterAction(projectId, name);
            if ("id" in result) {
              setCharacters((prev) =>
                prev.some((c) => c.id === result.id) ? prev : [...prev, result],
              );
            }
            return result;
          }}
        />
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-white/[0.02] p-4">
        <Label>Сценарий</Label>
        {isEdit ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={loadingScript}
              onClick={async () => {
                if (!scene) return;
                setLoadingScript(true);
                try {
                  const result = await loadScreenplayBlocksAction(projectId);
                  if ("versionId" in result && result.versionId) {
                    router.push(
                      `/${locale}/projects/${projectId}/screenplay/${result.versionId}?sceneId=${scene.id}`,
                    );
                  }
                } finally {
                  setLoadingScript(false);
                }
              }}
            >
              {loadingScript ? "Загрузка…" : "Открыть текст сцены"}
            </Button>
            <span className="text-xs text-[var(--muted-fg)]">
              Текст сцены редактируется в версии сценария; либретто — через
              «Обновить в либретто».
            </span>
          </div>
        ) : (
          <p className="mt-1 text-xs text-[var(--muted-fg)]">
            Сохраните сцену, затем откройте текст в блочном редакторе.
          </p>
        )}
      </div>

      <div>
        <Label className="mb-2 block">Хронометраж сцены (мм:сс)</Label>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(
            [
              ["planSeconds", "План", scene?.planSeconds],
              ["factSeconds", "Факт", scene?.factSeconds],
              ["preEditSeconds", "Премонтаж", scene?.preEditSeconds],
              ["editSeconds", "Монтаж", scene?.editSeconds],
            ] as const
          ).map(([name, label, value]) => (
            <div key={name}>
              <Label htmlFor={name}>{label}</Label>
              <Input
                id={name}
                name={name}
                placeholder="01:30"
                defaultValue={timingValue(value)}
              />
            </div>
          ))}
        </div>
      </div>

      {shootOnFilm ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="filmFootagePlan">Метраж плёнки план</Label>
            <Input
              id="filmFootagePlan"
              name="filmFootagePlan"
              type="number"
              defaultValue={decimalValue(scene?.filmFootagePlan)}
            />
          </div>
          <div>
            <Label htmlFor="filmFootageFact">Метраж плёнки факт</Label>
            <Input
              id="filmFootageFact"
              name="filmFootageFact"
              type="number"
              defaultValue={decimalValue(scene?.filmFootageFact)}
            />
          </div>
        </div>
      ) : null}

      <div>
        <Label htmlFor="summary">Краткое содержание</Label>
        <textarea
          id="summary"
          name="summary"
          rows={3}
          className="glass-input w-full resize-y px-3 py-2 text-sm"
          defaultValue={scene?.summary ?? ""}
        />
      </div>
      <div>
        <Label htmlFor="description">Примечание</Label>
        <textarea
          id="description"
          name="description"
          rows={2}
          className="glass-input w-full resize-y px-3 py-2 text-sm"
          defaultValue={scene?.description ?? ""}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="intExt">Инт/Нат</Label>
          <Select
            id="intExt"
            name="intExt"
            defaultValue={scene?.intExt ?? ""}
          >
            <option value="">—</option>
            {Object.entries(intExtLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="status">Статус</Label>
          <Select
            id="status"
            name="status"
            defaultValue={scene?.status ?? SceneStatus.PLANNING}
          >
            <option value={SceneStatus.PLANNING}>Планирование</option>
            <option value={SceneStatus.SHOT}>Снято</option>
            <option value={SceneStatus.RESHOOT_REQUIRED}>
              Требуется досъём
            </option>
            <option value={SceneStatus.OFF_PLAN}>Вне плана</option>
            <option value={SceneStatus.NOT_SHOT}>Не снято</option>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="montageMap">Монтажная карта</Label>
        <Input
          id="montageMap"
          name="montageMap"
          defaultValue={scene?.montageMap ?? ""}
        />
      </div>

      <div className="space-y-4 border-t border-[var(--border)] pt-4">
        {resourceCategories.length > 0 ? (
          <>
            <p className="text-xs text-[var(--muted-fg)]">
              Ресурсы из каталога (раздел «Ресурсы»). Старые блоки ниже — для
              совместимости.
            </p>
            {resourceCategories.map((cat) => (
              <SceneCategoryResourceBlock
                key={cat.id}
                projectId={projectId}
                category={cat}
                initialLinks={resourceItemsForCategory(scene, cat.id)}
              />
            ))}
          </>
        ) : (
          <p className="text-xs text-[var(--muted-fg)]">
            Добавьте категории ресурсов с флагом «в сценах» в разделе Ресурсы.
          </p>
        )}
        <SceneResourceBlock
          title="Массовка"
          category={SceneResourceCategory.EXTRAS}
          initialRows={resourcesFor(scene, SceneResourceCategory.EXTRAS)}
        />
        <SceneResourceBlock
          title="Групповка"
          category={SceneResourceCategory.GROUP}
          initialRows={resourcesFor(scene, SceneResourceCategory.GROUP)}
        />
        <SceneResourceBlock
          title="Каскадёр"
          category={SceneResourceCategory.STUNT}
          initialRows={resourcesFor(scene, SceneResourceCategory.STUNT)}
        />
      </div>

      <div className="grid gap-4 border-t border-[var(--border)] pt-4 md:grid-cols-2">
        <TagMultiField
          label="Грим"
          name="tag_makeup"
          initialTags={tagsFor(scene, ElementType.MAKEUP)}
        />
        <TagMultiField
          label="Костюм"
          name="tag_costume"
          initialTags={tagsFor(scene, ElementType.COSTUME)}
        />
        <TagMultiField
          label="Реквизит"
          name="tag_prop"
          initialTags={tagsFor(scene, ElementType.PROP)}
        />
        <TagMultiField
          label="Игровой транспорт"
          name="tag_vehicle"
          initialTags={tagsFor(scene, ElementType.VEHICLE)}
        />
      </div>

      <div className="border-t border-[var(--border)] pt-4">
        <SceneResourceBlock
          title="Новый ресурс"
          category={SceneResourceCategory.CUSTOM}
          initialRows={resourcesFor(scene, SceneResourceCategory.CUSTOM)}
        />
      </div>
    </fieldset>
  );
}
