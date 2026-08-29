"use client";

import { useActionState } from "react";
import { ElementType } from "@prisma/client";
import {
  createCharacterAction,
  createElementAction,
  deleteSceneAction,
  type ActionState,
} from "@/features/script/actions";
import { createLocationAction } from "@/features/locations/actions";
import {
  dayNightLabels,
  elementTypeLabels,
  intExtLabels,
  sceneStatusLabels,
} from "@/shared/i18n/domain-labels";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";

const initial: ActionState = {};

type SceneRow = {
  id: string;
  number: string;
  title: string | null;
  intExt: keyof typeof intExtLabels | null;
  dayNight: keyof typeof dayNightLabels | null;
  status: keyof typeof sceneStatusLabels;
  pageCount: { toString(): string } | null;
  locations: { location: { name: string } }[];
  characters: { character: { name: string } }[];
  elements: { element: { name: string } }[];
};

function joinNames(items: { name: string }[]): string {
  if (items.length === 0) return "—";
  return items.map((i) => i.name).join(", ");
}

export function ScenesTable({
  projectId,
  scenes,
  canWrite,
}: {
  projectId: string;
  scenes: SceneRow[];
  canWrite: boolean;
}) {
  if (scenes.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-fg)]">
        Сцен пока нет. Создайте справочники, затем добавьте первую сцену.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
            <th className="py-2 pr-3">№</th>
            <th className="py-2 pr-3">Сцена</th>
            <th className="py-2 pr-3">Локация</th>
            <th className="py-2 pr-3">Персонажи</th>
            <th className="py-2 pr-3">Стр.</th>
            {canWrite ? <th className="py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {scenes.map((scene) => (
            <tr
              key={scene.id}
              className="border-b border-[var(--border)]/70 align-top"
            >
              <td className="py-3 pr-3 font-semibold whitespace-nowrap">
                {scene.number}
              </td>
              <td className="py-3 pr-3 min-w-[10rem]">
                <div>{scene.title ?? "—"}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {scene.intExt ? (
                    <Badge>{intExtLabels[scene.intExt]}</Badge>
                  ) : null}
                  {scene.dayNight ? (
                    <Badge>{dayNightLabels[scene.dayNight]}</Badge>
                  ) : null}
                  <Badge>{sceneStatusLabels[scene.status]}</Badge>
                </div>
              </td>
              <td className="py-3 pr-3 text-[var(--muted-fg)]">
                {joinNames(scene.locations.map((l) => l.location))}
              </td>
              <td className="py-3 pr-3 text-[var(--muted-fg)]">
                {joinNames(scene.characters.map((c) => c.character))}
              </td>
              <td className="py-3 pr-3 whitespace-nowrap">
                {scene.pageCount?.toString() ?? "—"}
              </td>
              {canWrite ? (
                <td className="py-3 text-right">
                  <form
                    action={async () => {
                      await deleteSceneAction(projectId, scene.id);
                    }}
                  >
                    <Button type="submit" variant="danger">
                      Удалить
                    </Button>
                  </form>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuickAddForm({
  title,
  action,
  fields,
}: {
  title: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fields: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className="glass-panel space-y-3 p-3">
      <h4 className="text-sm font-semibold">{title}</h4>
      {fields}
      {state.error ? (
        <p className="text-xs text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.success ? (
        <p className="text-xs text-green-700">{state.success}</p>
      ) : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        Добавить
      </Button>
    </form>
  );
}

export function ScriptTagsPanel({
  projectId,
  canWrite,
}: {
  projectId: string;
  canWrite: boolean;
}) {
  if (!canWrite) return null;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <QuickAddForm
        title="Локация"
        action={createLocationAction.bind(null, projectId)}
        fields={
          <>
            <Input name="name" placeholder="Название" required />
            <Input name="address" placeholder="Адрес" />
          </>
        }
      />
      <QuickAddForm
        title="Персонаж"
        action={createCharacterAction.bind(null, projectId)}
        fields={<Input name="name" placeholder="Имя" required />}
      />
      <QuickAddForm
        title="Реквизит"
        action={createElementAction.bind(null, projectId)}
        fields={
          <>
            <Input name="name" placeholder="Название" required />
            <Select name="type" defaultValue={ElementType.PROP}>
              {Object.values(ElementType).map((t) => (
                <option key={t} value={t}>
                  {elementTypeLabels[t]}
                </option>
              ))}
            </Select>
          </>
        }
      />
    </div>
  );
}
