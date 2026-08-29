"use client";

import { useActionState } from "react";
import { DayNight, IntExt } from "@prisma/client";
import {
  createSceneAction,
  type ActionState,
} from "@/features/script/actions";
import {
  dayNightLabels,
  intExtLabels,
} from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { MultiSelect } from "@/shared/ui/multi-select";
import { Select } from "@/shared/ui/select";

const initial: ActionState = {};

type TagOption = { id: string; name: string };

export function SceneForm({
  projectId,
  locations,
  characters,
  elements,
  canWrite,
}: {
  projectId: string;
  locations: TagOption[];
  characters: TagOption[];
  elements: TagOption[];
  canWrite: boolean;
}) {
  const bound = createSceneAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);

  if (!canWrite) return null;

  return (
    <form
      action={action}
      className="glass-panel space-y-4 p-5"
    >
      <h3 className="font-display text-lg font-semibold">Добавить сцену</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="number">Номер сцены</Label>
          <Input id="number" name="number" placeholder="1, 12A" required />
        </div>
        <div>
          <Label htmlFor="title">Название</Label>
          <Input id="title" name="title" placeholder="Необязательно" />
        </div>
        <div>
          <Label htmlFor="intExt">INT/EXT</Label>
          <Select id="intExt" name="intExt" defaultValue="">
            <option value="">—</option>
            {Object.values(IntExt).map((v) => (
              <option key={v} value={v}>
                {intExtLabels[v]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="dayNight">День/ночь</Label>
          <Select id="dayNight" name="dayNight" defaultValue="">
            <option value="">—</option>
            {Object.values(DayNight).map((v) => (
              <option key={v} value={v}>
                {dayNightLabels[v]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="pageCount">Страницы</Label>
          <Input
            id="pageCount"
            name="pageCount"
            type="number"
            step="0.125"
            min="0"
          />
        </div>
        <div>
          <Label htmlFor="estimatedDurationMin">Минуты (оценка)</Label>
          <Input
            id="estimatedDurationMin"
            name="estimatedDurationMin"
            type="number"
            min="0"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="description">Описание</Label>
        <Input id="description" name="description" />
      </div>

      <div className="grid gap-4 border-t border-[var(--border)] pt-4 md:grid-cols-3">
        <div>
          <Label htmlFor="locationId">Локация</Label>
          {locations.length > 0 ? (
            <Select id="locationId" name="locationId" defaultValue="">
              <option value="">— не выбрана —</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </Select>
          ) : (
            <p className="mt-1 text-xs text-[var(--muted-fg)]">
              Сначала добавьте локацию в справочнике выше.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="characterIds">Персонажи</Label>
          {characters.length > 0 ? (
            <MultiSelect
              id="characterIds"
              name="characterIds"
              hint="Ctrl+клик для нескольких"
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </MultiSelect>
          ) : (
            <p className="mt-1 text-xs text-[var(--muted-fg)]">
              Сначала добавьте персонажей в справочнике.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="elementIds">Реквизит / элементы</Label>
          {elements.length > 0 ? (
            <MultiSelect
              id="elementIds"
              name="elementIds"
              hint="Ctrl+клик для нескольких"
            >
              {elements.map((el) => (
                <option key={el.id} value={el.id}>
                  {el.name}
                </option>
              ))}
            </MultiSelect>
          ) : (
            <p className="mt-1 text-xs text-[var(--muted-fg)]">
              Сначала добавьте реквизит в справочнике.
            </p>
          )}
        </div>
      </div>

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.success ? (
        <p className="text-sm text-green-700">{state.success}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "…" : "Добавить сцену"}
      </Button>
    </form>
  );
}
