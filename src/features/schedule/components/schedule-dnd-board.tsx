"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  assignSceneToDayByDnDAction,
  reorderScenesAction,
} from "@/features/schedule/actions";
import { DayContextMenu, type MenuAnchor } from "@/features/schedule/components/day-context-menu";
import {
  SceneDetailsModal,
  type SceneDetails,
} from "@/features/schedule/components/scene-details-modal";
import {
  computeDaySummary,
  formatDaySummary,
  formatSceneBrief,
  formatPagesMinutes,
  groupScenesByLocation,
} from "@/features/schedule/lib/day-summary";
import {
  dayNightLabels,
  intExtLabels,
  shootDayTypeLabels,
} from "@/shared/i18n/domain-labels";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import { cn } from "@/shared/lib/cn";

type SceneCard = SceneDetails;

type DayScene = {
  id: string;
  sortOrder: number;
  scene: SceneCard;
};

type ShootDay = {
  id: string;
  dayNumber: number;
  date: Date;
  dayType: keyof typeof shootDayTypeLabels;
  isLocked: boolean;
  isNightShift: boolean;
  comment: string | null;
  scenes: DayScene[];
};

type GroupBy = "none" | "location";

function DragHandle({
  listeners,
  attributes,
}: {
  listeners?: object;
  attributes?: object;
}) {
  return (
    <button
      type="button"
      className="shrink-0 cursor-grab touch-none rounded px-0.5 py-1 text-[var(--muted-fg)] hover:bg-white/10 hover:text-white active:cursor-grabbing"
      aria-label="Перетащить"
      {...attributes}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
    >
      ⠿
    </button>
  );
}

function dayTypeTone(dayType: keyof typeof shootDayTypeLabels) {
  switch (dayType) {
    case "OFF":
      return {
        column: "border-zinc-500/35 bg-zinc-900/55",
        header: "border-zinc-500/25 bg-zinc-800/50",
        accent: "text-zinc-300",
      };
    case "REST":
      return {
        column: "border-amber-500/35 bg-amber-950/40",
        header: "border-amber-500/25 bg-amber-900/35",
        accent: "text-amber-200",
      };
    case "PREP":
      return {
        column: "border-emerald-500/35 bg-emerald-950/40",
        header: "border-emerald-500/25 bg-emerald-900/35",
        accent: "text-emerald-200",
      };
    default:
      return {
        column: "border-sky-500/30 bg-sky-950/35",
        header: "border-sky-500/20 bg-sky-900/30",
        accent: "text-sky-200",
      };
  }
}

function SceneCardBody({ scene }: { scene: SceneCard }) {
  const chars = scene.characters.map((c) => c.character.name).join(", ");
  return (
    <>
      <div className="font-semibold leading-snug">{formatSceneBrief(scene)}</div>
      {chars ? (
        <div className="mt-1 line-clamp-2 text-[var(--muted-fg)]">{chars}</div>
      ) : null}
      <div className="mt-1 text-[var(--muted-fg)]">
        {formatPagesMinutes(scene.pageCount, scene.planSeconds)}
        {scene.scriptDay != null ? ` · день #${scene.scriptDay}` : ""}
      </div>
    </>
  );
}

function sceneCardClass(isDragging?: boolean) {
  return cn(
    "flex gap-1.5 rounded-xl border border-white/10 bg-[#121a2a]/95 p-2 text-xs",
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
    isDragging && "opacity-40",
  );
}

function DraggableSceneCard({
  scene,
  dragId,
  canWrite,
  onOpen,
}: {
  scene: SceneCard;
  dragId: string;
  canWrite: boolean;
  onOpen: (scene: SceneCard) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: dragId, data: { sceneId: scene.id }, disabled: !canWrite });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(sceneCardClass(isDragging), "border-l-[3px] border-l-teal-400/70")}
    >
      {canWrite ? (
        <DragHandle listeners={listeners} attributes={attributes} />
      ) : null}
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer text-left"
        onClick={() => onOpen(scene)}
      >
        <SceneCardBody scene={scene} />
      </button>
    </div>
  );
}

function SortableDayScene({
  row,
  canWrite,
  onOpen,
}: {
  row: DayScene;
  canWrite: boolean;
  onOpen: (scene: SceneCard) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: row.id,
      data: { sceneId: row.scene.id },
      disabled: !canWrite,
    });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        sceneCardClass(isDragging),
        "border-l-[3px] border-l-sky-400/70",
        isDragging && "opacity-50",
      )}
    >
      {canWrite ? (
        <DragHandle listeners={listeners} attributes={attributes} />
      ) : null}
      <button
        type="button"
        className="min-w-0 flex-1 cursor-pointer text-left"
        onClick={() => onOpen(row.scene)}
      >
        <SceneCardBody scene={row.scene} />
      </button>
    </div>
  );
}

function DayColumn({
  day,
  canWrite,
  onMenu,
  onOpenScene,
}: {
  day: ShootDay;
  canWrite: boolean;
  onMenu: (dayId: string, anchor: MenuAnchor) => void;
  onOpenScene: (scene: SceneCard) => void;
}) {
  const columnRef = useRef<HTMLDivElement>(null);
  const { setNodeRef, isOver } = useDroppable({ id: `day-${day.id}` });
  const summary = computeDaySummary(day.scenes);
  const tone = dayTypeTone(day.dayType);
  const dateStr = new Date(day.date).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <div
      ref={columnRef}
      className={cn(
        "flex h-full w-56 shrink-0 flex-col overflow-hidden rounded-xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
        tone.column,
        day.isNightShift && "ring-1 ring-indigo-400/40",
        isOver && "ring-2 ring-[var(--accent)]",
      )}
    >
      <div className={cn("border-b p-2", tone.header)}>
        <div className="flex items-start justify-between gap-1">
          <div>
            <div className="text-xs font-semibold">
              {dateStr}
              {day.isNightShift ? " · ночь" : ""}
            </div>
            <div className={cn("text-[10px]", tone.accent)}>
              День {day.dayNumber} · {shootDayTypeLabels[day.dayType]}
            </div>
          </div>
          {canWrite ? (
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[var(--muted-fg)] hover:bg-white/10 hover:text-white"
              onClick={() => {
                const r = columnRef.current?.getBoundingClientRect();
                if (!r) return;
                onMenu(day.id, {
                  top: r.top,
                  left: r.left,
                  bottom: r.bottom,
                  right: r.right,
                });
              }}
              aria-label="Меню дня"
            >
              ⋮
            </button>
          ) : null}
        </div>
        <div className="mt-1 text-[10px] text-[var(--muted-fg)]">
          {formatDaySummary(summary)}
        </div>
        {day.isLocked ? <Badge className="mt-1">Зафиксирован</Badge> : null}
        {day.comment ? (
          <p className="mt-1 line-clamp-2 text-[10px] text-[var(--muted-fg)]">
            {day.comment}
          </p>
        ) : null}
      </div>
      <div
        ref={setNodeRef}
        className="flex min-h-[8rem] flex-1 flex-col gap-2 bg-black/20 p-2"
      >
        <SortableContext
          items={day.scenes.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {day.scenes.map((row) => (
            <SortableDayScene
              key={row.id}
              row={row}
              canWrite={canWrite && !day.isLocked}
              onOpen={onOpenScene}
            />
          ))}
        </SortableContext>
        {day.scenes.length === 0 ? (
          <p className="py-4 text-center text-[10px] text-[var(--muted-fg)]">
            Перетащите сцену сюда
          </p>
        ) : null}
      </div>
    </div>
  );
}

function matchesFilters(
  scene: SceneCard,
  filters: {
    q: string;
    location: string;
    intExt: string;
    dayNight: string;
  },
) {
  if (filters.location) {
    const names = scene.locations.map((l) => l.location.name);
    if (!names.includes(filters.location)) return false;
  }
  if (filters.intExt && scene.intExt !== filters.intExt) return false;
  if (filters.dayNight && scene.dayNight !== filters.dayNight) return false;
  if (filters.q.trim()) {
    const q = filters.q.trim().toLowerCase();
    const hay = [
      formatSceneBrief(scene),
      scene.title ?? "",
      scene.summary ?? "",
      ...scene.characters.map((c) => c.character.name),
      ...scene.locations.map((l) => l.location.name),
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function ScheduleDnDBoard({
  projectId,
  locale,
  shootDays,
  unscheduled,
  canWrite,
}: {
  projectId: string;
  locale: string;
  shootDays: ShootDay[];
  unscheduled: SceneCard[];
  canWrite: boolean;
}) {
  const [activeScene, setActiveScene] = useState<SceneCard | null>(null);
  const [menuState, setMenuState] = useState<{
    dayId: string;
    anchor: MenuAnchor;
  } | null>(null);
  const [detailScene, setDetailScene] = useState<SceneCard | null>(null);
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [intExt, setIntExt] = useState("");
  const [dayNight, setDayNight] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const locationOptions = useMemo(() => {
    const set = new Set<string>();
    for (const scene of unscheduled) {
      for (const link of scene.locations) {
        set.add(link.location.name);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [unscheduled]);

  const filtered = useMemo(
    () =>
      unscheduled.filter((scene) =>
        matchesFilters(scene, { q, location, intExt, dayNight }),
      ),
    [unscheduled, q, location, intExt, dayNight],
  );

  const hasActiveFilters = Boolean(q || location || intExt || dayNight);

  const displayBlocks = useMemo(() => {
    if (groupBy === "location") {
      return groupScenesByLocation(filtered);
    }
    return [["", filtered] as [string, SceneCard[]]];
  }, [filtered, groupBy]);

  async function handleDragEnd(event: DragEndEvent) {
    setActiveScene(null);
    const { active, over } = event;
    if (!over || !canWrite) return;

    const sceneId = active.data.current?.sceneId as string | undefined;
    const overId = String(over.id);

    if (overId.startsWith("day-") && sceneId) {
      const shootDayId = overId.replace("day-", "");
      await assignSceneToDayByDnDAction(projectId, shootDayId, sceneId);
      return;
    }

    if (active.id !== over.id && !String(active.id).startsWith("unsched-")) {
      const day = shootDays.find((d) =>
        d.scenes.some((s) => s.id === active.id),
      );
      if (!day) return;
      const ids = day.scenes.map((s) => s.id);
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = [...ids];
      reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, String(active.id));
      await reorderScenesAction(projectId, day.id, reordered);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const sceneId = event.active.data.current?.sceneId as string | undefined;
    if (!sceneId) {
      // sortable rows in day use row.id — resolve scene from shoot day
      const row = shootDays
        .flatMap((d) => d.scenes)
        .find((r) => r.id === event.active.id);
      if (row) setActiveScene(row.scene);
      return;
    }
    const scene =
      unscheduled.find((s) => s.id === sceneId) ??
      shootDays.flatMap((d) => d.scenes).find((r) => r.scene.id === sceneId)
        ?.scene;
    if (scene) setActiveScene(scene);
  }

  const menuDay = shootDays.find((d) => d.id === menuState?.dayId);

  function resetFilters() {
    setQ("");
    setLocation("");
    setIntExt("");
    setDayNight("");
    setGroupBy("none");
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full min-h-[28rem] overflow-hidden rounded-2xl border border-[var(--border-strong)] shadow-[var(--glass-shadow)]">
        <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-r-2 border-teal-500/40 bg-gradient-to-b from-teal-950/70 via-[#0b1520] to-[#081018]">
          <div className="border-b border-teal-500/25 bg-teal-950/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold leading-snug text-teal-50">
                Неспланированные сцены
              </h3>
              <button
                type="button"
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-[11px] text-teal-100/80 hover:bg-teal-400/15",
                  (filtersOpen || hasActiveFilters) &&
                    "bg-teal-400/20 text-teal-50",
                )}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                Фильтры
                {hasActiveFilters ? " ·" : ""}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-teal-200/65">
              {filtered.length}
              {hasActiveFilters ? ` из ${unscheduled.length}` : ""} сц.
            </p>

            {filtersOpen ? (
              <div className="mt-3 space-y-2">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Поиск…"
                  className="py-2 text-xs"
                />
                <Select
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="text-xs"
                >
                  <option value="">Все объекты</option>
                  {locationOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
                <Select
                  value={intExt}
                  onChange={(e) => setIntExt(e.target.value)}
                  className="text-xs"
                >
                  <option value="">Тип объекта: все</option>
                  {(
                    Object.entries(intExtLabels) as [
                      keyof typeof intExtLabels,
                      string,
                    ][]
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Select
                  value={dayNight}
                  onChange={(e) => setDayNight(e.target.value)}
                  className="text-xs"
                >
                  <option value="">Режим: все</option>
                  {(
                    Object.entries(dayNightLabels) as [
                      keyof typeof dayNightLabels,
                      string,
                    ][]
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                  className="text-xs"
                >
                  <option value="none">Без группировки</option>
                  <option value="location">Группировать по объекту</option>
                </Select>
                {hasActiveFilters || groupBy !== "none" ? (
                  <button
                    type="button"
                    className="text-[11px] text-[var(--muted-fg)] underline-offset-2 hover:text-white hover:underline"
                    onClick={resetFilters}
                  >
                    Сбросить фильтры
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-3">
            {displayBlocks.map(([loc, items]) => (
              <div key={loc || "__flat"}>
                {groupBy === "location" && loc ? (
                  <div className="mb-2 rounded-md bg-teal-900/45 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-teal-100/90">
                    {loc} ({items.length})
                  </div>
                ) : null}
                <div className="space-y-2">
                  {items.map((scene) => (
                    <DraggableSceneCard
                      key={scene.id}
                      scene={scene}
                      dragId={`unsched-${scene.id}`}
                      canWrite={canWrite}
                      onOpen={setDetailScene}
                    />
                  ))}
                </div>
              </div>
            ))}
            {filtered.length === 0 ? (
              <p className="text-xs text-[var(--muted-fg)]">
                {unscheduled.length === 0
                  ? "Все сцены распределены по дням."
                  : "Нет сцен по выбранным фильтрам."}
              </p>
            ) : null}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto bg-gradient-to-br from-slate-950 via-[#0a1224] to-indigo-950/50 p-3">
          {shootDays.map((day) => (
            <DayColumn
              key={day.id}
              day={day}
              canWrite={canWrite}
              onMenu={(dayId, anchor) => setMenuState({ dayId, anchor })}
              onOpenScene={setDetailScene}
            />
          ))}
          {shootDays.length === 0 ? (
            <p className="p-4 text-sm text-[var(--muted-fg)]">
              Создайте съёмочные дни, чтобы начать планирование.
            </p>
          ) : null}
        </div>
      </div>

      <DragOverlay>
        {activeScene ? (
          <div className="glass-panel w-52 p-2 text-xs shadow-xl">
            {formatSceneBrief(activeScene)}
          </div>
        ) : null}
      </DragOverlay>

      {menuDay && menuState && canWrite ? (
        <DayContextMenu
          projectId={projectId}
          locale={locale}
          day={menuDay}
          anchor={menuState.anchor}
          onClose={() => setMenuState(null)}
        />
      ) : null}

      <SceneDetailsModal
        scene={detailScene}
        onClose={() => setDetailScene(null)}
      />
    </DndContext>
  );
}
