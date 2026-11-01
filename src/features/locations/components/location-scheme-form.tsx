"use client";

import { useActionState, useId, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  saveLocationSchemeAction,
  type LocationActionState,
} from "@/features/locations/actions";
import {
  formatCoordinates,
  parseCoordinates,
} from "@/features/locations/lib/coordinates";
import {
  MAX_POINT_DESCRIPTION,
  MAX_POINT_NAME,
  MAX_POINT_NUMBER,
  MAX_SCHEME_POINTS,
  MAX_SCHEME_TEXT,
} from "@/features/locations/lib/scheme-rules";
import type { LocationDetail } from "@/features/locations/queries";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { useFormGuard } from "@/shared/ui/unsaved/use-form-guard";

type SchemeSource = Pick<
  LocationDetail,
  "id" | "latitude" | "longitude" | "directions" | "parking" | "onSiteNotes" | "points"
>;

type Point = { key: string; number: string; name: string; description: string };

const initial: LocationActionState = {};

const TEXT_FIELDS = [
  { name: "directions", label: "Как добраться", placeholder: "Метро, съезд с трассы, ворота…" },
  { name: "parking", label: "Парковка", placeholder: "Где ставить технику и личные машины" },
  { name: "onSiteNotes", label: "На месте", placeholder: "Куда идти, где база, туалеты, правила площадки" },
] as const;

/** Точка схемы с перетаскиванием за ⠿. */
function SortablePoint({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex flex-wrap items-start gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--surface-1)] px-3 py-2.5 text-sm",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        type="button"
        className="mt-2 cursor-grab touch-none px-1 text-[var(--muted-fg)] active:cursor-grabbing"
        aria-label="Перетащить точку"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      {children}
    </div>
  );
}

function ReadOnlyScheme({ location }: { location: SchemeSource }) {
  const coordinates = formatCoordinates(location.latitude, location.longitude);
  return (
    <dl className="space-y-3 text-sm">
      <div>
        <dt className="text-[var(--muted-fg)]">Координаты</dt>
        <dd>{coordinates || "—"}</dd>
      </div>
      {TEXT_FIELDS.map((field) => (
        <div key={field.name}>
          <dt className="text-[var(--muted-fg)]">{field.label}</dt>
          <dd className="whitespace-pre-wrap">{location[field.name] || "—"}</dd>
        </div>
      ))}
      <div>
        <dt className="text-[var(--muted-fg)]">Точки</dt>
        <dd>
          {location.points.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {location.points.map((p) => (
                <li key={p.id}>
                  <span className="font-medium">{p.number}</span> {p.name}
                  {p.description ? (
                    <span className="text-[var(--muted-fg)]"> — {p.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            "—"
          )}
        </dd>
      </div>
    </dl>
  );
}

/** Блок карточки объекта «Схема объекта для вызывного». */
export function LocationSchemeForm({
  projectId,
  location,
  canWrite,
}: {
  projectId: string;
  location: SchemeSource;
  canWrite: boolean;
}) {
  const bound = saveLocationSchemeAction.bind(null, projectId, location.id);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  const { ref, markClean } = useFormGuard<HTMLFormElement>(canWrite, undefined, state);
  useActionSuccess(state, markClean);

  const [coordinates, setCoordinates] = useState(() =>
    formatCoordinates(location.latitude, location.longitude),
  );
  const coordinatesCheck = parseCoordinates(coordinates);
  const coordinatesError = "error" in coordinatesCheck ? coordinatesCheck.error : null;

  const nextKey = useRef(0);
  const [points, setPoints] = useState<Point[]>(() =>
    location.points.map((p) => ({
      key: p.id,
      number: p.number,
      name: p.name,
      description: p.description ?? "",
    })),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  // Постоянный id: иначе служебные aria-атрибуты dnd-kit на сервере и в браузере расходятся.
  const dndId = useId();

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPoints((rows) => {
      const oldIndex = rows.findIndex((r) => r.key === active.id);
      const newIndex = rows.findIndex((r) => r.key === over.id);
      if (oldIndex < 0 || newIndex < 0) return rows;
      return arrayMove(rows, oldIndex, newIndex);
    });
  }

  function patch(key: string, change: Partial<Point>) {
    setPoints((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function addPoint() {
    setPoints((rows) => [
      ...rows,
      {
        key: `n${nextKey.current++}`,
        number: String(rows.length + 1),
        name: "",
        description: "",
      },
    ]);
  }

  const pointsPayload = JSON.stringify(
    points.map((p) => ({ number: p.number, name: p.name, description: p.description })),
  );

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h3 className="font-semibold">Схема объекта для вызывного</h3>
        <p className="mt-0.5 text-xs text-[var(--muted-fg)]">
          Попадает в вызывной: координаты, как добраться, парковка и точки на объекте.
        </p>
      </div>
      {!canWrite ? (
        <ReadOnlyScheme location={location} />
      ) : (
        <form ref={ref} onSubmit={submitKeepingFields(action)} className="space-y-4">
          <input type="hidden" name="points" value={pointsPayload} />
          <div>
            <Label htmlFor="schemeCoordinates">Координаты</Label>
            <Input
              id="schemeCoordinates"
              name="coordinates"
              placeholder="59.938, 30.314"
              maxLength={100}
              value={coordinates}
              onChange={(e) => setCoordinates(e.target.value)}
              aria-invalid={coordinatesError ? true : undefined}
              aria-describedby="schemeCoordinatesHint"
            />
            {coordinatesError ? (
              <p
                id="schemeCoordinatesHint"
                role="alert"
                className="mt-1 text-xs text-[var(--danger)]"
              >
                {coordinatesError}
              </p>
            ) : (
              <p id="schemeCoordinatesHint" className="mt-1 text-xs text-[var(--muted-fg)]">
                Скопируйте из Яндекс или Google Карт. Пусто — восход и закат по городу проекта.
              </p>
            )}
          </div>

          {TEXT_FIELDS.map((field) => (
            <div key={field.name}>
              <Label htmlFor={`scheme-${field.name}`}>{field.label}</Label>
              <textarea
                id={`scheme-${field.name}`}
                name={field.name}
                rows={2}
                maxLength={MAX_SCHEME_TEXT}
                className="glass-input w-full resize-y px-3 py-2 text-sm"
                placeholder={field.placeholder}
                defaultValue={location[field.name] ?? ""}
              />
            </div>
          ))}

          <section className="space-y-2">
            <div>
              <h4 className="text-sm font-medium">Точки на объекте</h4>
              <p className="mt-0.5 text-xs text-[var(--muted-fg)]">
                Номер, название и описание — как на схеме. Порядок — перетаскиванием за ⠿.
              </p>
            </div>
            {points.length === 0 ? (
              <p className="text-sm text-[var(--muted-fg)]">Точек пока нет.</p>
            ) : (
              <DndContext
                id={dndId}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={points.map((p) => p.key)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {points.map((row, index) => (
                      <SortablePoint key={row.key} id={row.key}>
                        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[5rem_1fr]">
                          <Input
                            aria-label={`Номер, точка ${index + 1}`}
                            placeholder="№ *"
                            required
                            maxLength={MAX_POINT_NUMBER}
                            value={row.number}
                            onChange={(e) => patch(row.key, { number: e.target.value })}
                          />
                          <Input
                            aria-label={`Название, точка ${index + 1}`}
                            placeholder="Название *"
                            required
                            maxLength={MAX_POINT_NAME}
                            value={row.name}
                            onChange={(e) => patch(row.key, { name: e.target.value })}
                          />
                          <textarea
                            aria-label={`Описание, точка ${index + 1}`}
                            placeholder="Описание"
                            rows={1}
                            maxLength={MAX_POINT_DESCRIPTION}
                            className="glass-input w-full resize-y px-3 py-2 text-sm sm:col-span-2"
                            value={row.description}
                            onChange={(e) => patch(row.key, { description: e.target.value })}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`Убрать точку ${index + 1}`}
                          title={`Убрать точку ${index + 1}`}
                          onClick={() =>
                            setPoints((rows) => rows.filter((r) => r.key !== row.key))
                          }
                        >
                          ✕
                        </Button>
                      </SortablePoint>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            {points.length < MAX_SCHEME_POINTS ? (
              <Button type="button" variant="secondary" onClick={addPoint}>
                + Точка
              </Button>
            ) : null}
          </section>

          <div className="border-t border-[var(--border)]/60 pt-4">
            <Button type="submit" disabled={pending || coordinatesError !== null}>
              {pending ? "…" : "Сохранить схему"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
