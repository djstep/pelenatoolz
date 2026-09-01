"use client";

import { useMemo, useRef, useState, useEffect } from "react";
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
  buildDaySceneVisualBlocks,
  groupScenesByLocation,
  groupScenesByActor,
  type SceneGroupMode,
} from "@/features/schedule/lib/day-summary";
import {
  dayNightLabels,
  intExtLabels,
  shootDayTypeLabels,
} from "@/shared/i18n/domain-labels";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { Select } from "@/shared/ui/select";
import {
  computePlanningHint,
  resolveRowIdByActor,
} from "@/features/actor-availability/lib/planning-hint";
import {
  planningHintClass,
  type PlanningHint,
} from "@/features/actor-availability/lib/status";
import type { ScheduleAvailabilityBundle } from "@/features/actor-availability/lib/serialize-bundle";
import { isWorkingShootDay } from "@/features/schedule/lib/shoot-day-type";
import { formatDateShort } from "@/shared/i18n/format-date";
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
  prepNote?: string | null;
  scenes: DayScene[];
};

type UnscheduledGroupBy = "none" | SceneGroupMode;
type DayGroupBy = "none" | SceneGroupMode;

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
  const skipClickRef = useRef(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: dragId, data: { sceneId: scene.id }, disabled: !canWrite });

  useEffect(() => {
    if (isDragging) skipClickRef.current = true;
  }, [isDragging]);

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(canWrite ? listeners : {})}
      {...(canWrite ? attributes : {})}
      className={cn(
        sceneCardClass(isDragging),
        "border-l-[3px] border-l-teal-400/70",
        canWrite && "cursor-grab touch-none active:cursor-grabbing",
      )}
      onClick={() => {
        if (skipClickRef.current) {
          skipClickRef.current = false;
          return;
        }
        onOpen(scene);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(scene);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <SceneCardBody scene={scene} />
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
  const skipClickRef = useRef(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: row.id,
      data: { sceneId: row.scene.id },
      disabled: !canWrite,
    });

  useEffect(() => {
    if (isDragging) skipClickRef.current = true;
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...(canWrite ? listeners : {})}
      {...(canWrite ? attributes : {})}
      className={cn(
        sceneCardClass(isDragging),
        "border-l-[3px] border-l-sky-400/70",
        isDragging && "opacity-50",
        canWrite && "cursor-grab touch-none active:cursor-grabbing",
      )}
      onClick={() => {
        if (skipClickRef.current) {
          skipClickRef.current = false;
          return;
        }
        onOpen(row.scene);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(row.scene);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <SceneCardBody scene={row.scene} />
    </div>
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
    "rounded-xl border border-white/10 bg-[#121a2a]/95 p-2 text-xs",
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
    isDragging && "opacity-40",
  );
}

function DaySceneGroupHeader({
  label,
  mode,
}: {
  label: string;
  mode: SceneGroupMode;
}) {
  return (
    <div
      className={cn(
        "rounded-md px-2 py-1 text-[10px] font-semibold leading-snug",
        mode === "location"
          ? "bg-sky-900/55 text-sky-100/90"
          : "bg-violet-900/55 text-violet-100/90",
      )}
    >
      {label}
    </div>
  );
}

function DayColumn({
  day,
  canWrite,
  onMenu,
  onOpenScene,
  planningHint,
  dayGroupBy,
  characterToActor,
  actorNames,
}: {
  day: ShootDay;
  canWrite: boolean;
  onMenu: (dayId: string, anchor: MenuAnchor) => void;
  onOpenScene: (scene: SceneCard) => void;
  planningHint?: PlanningHint;
  dayGroupBy: DayGroupBy;
  characterToActor: Record<string, string>;
  actorNames: Record<string, string>;
}) {
  const columnRef = useRef<HTMLDivElement>(null);
  const acceptsScenes =
    isWorkingShootDay(day.dayType) && !day.isLocked;
  const canDragScenes = canWrite && acceptsScenes;
  const { setNodeRef, isOver } = useDroppable({
    id: `day-${day.id}`,
    disabled: !acceptsScenes,
  });
  const summary = computeDaySummary(day.scenes);
  const tone = dayTypeTone(day.dayType);
  const dateStr = formatDateShort(day.date);
  const visualBlocks = useMemo(
    () =>
      buildDaySceneVisualBlocks(
        day.scenes,
        dayGroupBy,
        characterToActor,
        actorNames,
      ),
    [day.scenes, dayGroupBy, characterToActor, actorNames],
  );

  return (
    <div
      ref={columnRef}
      className={cn(
        "flex h-full w-56 shrink-0 flex-col overflow-hidden rounded-xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
        tone.column,
        day.isNightShift && "ring-1 ring-indigo-400/40",
        isOver && acceptsScenes && "ring-2 ring-[var(--accent)]",
        planningHint && planningHint !== "neutral" && planningHintClass[planningHint],
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
        {day.dayType === "PREP" && day.prepNote ? (
          <p className="mt-1 line-clamp-2 text-[10px] text-emerald-100/85">
            {day.prepNote}
          </p>
        ) : null}
        {day.comment ? (
          <p className="mt-1 line-clamp-2 text-[10px] text-[var(--muted-fg)]">
            {day.comment}
          </p>
        ) : null}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[8rem] flex-1 flex-col gap-2 bg-black/20 p-2",
          !acceptsScenes && "opacity-90",
        )}
      >
        <SortableContext
          items={day.scenes.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {visualBlocks.map((block, index) =>
            block.type === "header" ? (
              <DaySceneGroupHeader
                key={`${day.id}-hdr-${block.label}-${index}`}
                label={block.label}
                mode={dayGroupBy as SceneGroupMode}
              />
            ) : (
              <SortableDayScene
                key={block.row.id}
                row={block.row}
                canWrite={canDragScenes}
                onOpen={onOpenScene}
              />
            ),
          )}
        </SortableContext>
        {day.scenes.length === 0 ? (
          <p className="py-4 text-center text-[10px] text-[var(--muted-fg)]">
            {acceptsScenes
              ? "Перетащите сцену сюда"
              : "Сцены только в рабочие дни"}
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
  availability,
}: {
  projectId: string;
  locale: string;
  shootDays: ShootDay[];
  unscheduled: SceneCard[];
  canWrite: boolean;
  availability?: ScheduleAvailabilityBundle;
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
  const [unscheduledGroupBy, setUnscheduledGroupBy] =
    useState<UnscheduledGroupBy>("none");
  const [dayGroupBy, setDayGroupBy] = useState<DayGroupBy>("none");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const characterToActor = availability?.characterToActor ?? {};
  const actorNames = availability?.actorNames ?? {};

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
    if (unscheduledGroupBy === "location") {
      return groupScenesByLocation(filtered);
    }
    if (unscheduledGroupBy === "actor") {
      return groupScenesByActor(filtered, characterToActor, actorNames);
    }
    return [["", filtered] as [string, SceneCard[]]];
  }, [filtered, unscheduledGroupBy, characterToActor, actorNames]);

  const availContext = useMemo(() => {
    if (!availability) return null;
    const kppBusy = new Map(
      Object.entries(availability.kppBusySerialized).map(
        ([k, v]) => [k, new Set(v)] as const,
      ),
    );
    return {
      characterToActor: availability.characterToActor,
      manualDays: availability.manualDays,
      kppBusy,
      rowIdByActor: resolveRowIdByActor(availability.rows),
    };
  }, [availability]);

  function hintForDay(day: ShootDay): PlanningHint | undefined {
    if (!activeScene || !availContext) return undefined;
    const charIds = activeScene.characters.map((c) => c.character.id);
    return computePlanningHint(
      charIds,
      new Date(day.date),
      availContext.characterToActor,
      availContext.manualDays,
      availContext.rowIdByActor,
      availContext.kppBusy,
    );
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveScene(null);
    const { active, over } = event;
    if (!over || !canWrite) return;

    const sceneId = active.data.current?.sceneId as string | undefined;
    const overId = String(over.id);

    if (overId.startsWith("day-") && sceneId) {
      const shootDayId = overId.replace("day-", "");
      const targetDay = shootDays.find((d) => d.id === shootDayId);
      if (
        !targetDay ||
        !isWorkingShootDay(targetDay.dayType) ||
        targetDay.isLocked
      ) {
        return;
      }
      await assignSceneToDayByDnDAction(projectId, shootDayId, sceneId);
      return;
    }

    if (active.id !== over.id && !String(active.id).startsWith("unsched-")) {
      const day = shootDays.find((d) =>
        d.scenes.some((s) => s.id === active.id),
      );
      if (!day || !isWorkingShootDay(day.dayType) || day.isLocked) return;
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
    setUnscheduledGroupBy("none");
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
                  value={unscheduledGroupBy}
                  onChange={(e) =>
                    setUnscheduledGroupBy(e.target.value as UnscheduledGroupBy)
                  }
                  className="text-xs"
                >
                  <option value="none">Без группировки</option>
                  <option value="location">Группировать по объекту</option>
                  <option value="actor">Группировать по актёру</option>
                </Select>
                {hasActiveFilters || unscheduledGroupBy !== "none" ? (
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
                {unscheduledGroupBy === "location" && loc ? (
                  <div className="mb-2 rounded-md bg-teal-900/45 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-teal-100/90">
                    {loc} ({items.length})
                  </div>
                ) : null}
                {unscheduledGroupBy === "actor" && loc ? (
                  <div className="mb-2 rounded-md bg-violet-900/45 px-2 py-1 text-[11px] font-semibold tracking-wide text-violet-100/90">
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

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 bg-black/30 px-3 py-2 text-[10px] text-[var(--muted-fg)]">
            <label className="inline-flex items-center gap-2">
              <span className="shrink-0 text-[var(--foreground)]/80">
                Сцены в дне:
              </span>
              <select
                value={dayGroupBy}
                onChange={(e) => setDayGroupBy(e.target.value as DayGroupBy)}
                className="glass-input h-7 w-[9.5rem] shrink-0 rounded-lg px-2 text-[10px] leading-none text-[var(--foreground)]"
              >
                <option value="none">Список</option>
                <option value="location">По объекту</option>
                <option value="actor">По актёру</option>
              </select>
            </label>
            <span className="hidden h-3 w-px bg-white/15 sm:inline" aria-hidden />
            <span className="text-[var(--foreground)]/80">Типы дней:</span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-5 rounded border border-sky-500/40 bg-sky-950/60" />
              {shootDayTypeLabels.WORKING}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-5 rounded border border-zinc-500/40 bg-zinc-900/60" />
              {shootDayTypeLabels.OFF}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-5 rounded border border-amber-500/40 bg-amber-950/50" />
              {shootDayTypeLabels.REST}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-5 rounded border border-emerald-500/40 bg-emerald-950/50" />
              {shootDayTypeLabels.PREP}
            </span>
          </div>
          {activeScene && availContext ? (
            <div className="flex shrink-0 flex-wrap gap-3 border-b border-white/10 bg-black/30 px-3 py-2 text-[10px] text-[var(--muted-fg)]">
              <span>Занятость актёров сцены:</span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-6 rounded ring-2 ring-emerald-400/70" /> все свободны
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-6 rounded ring-2 ring-amber-400/70" /> частично
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-6 rounded ring-2 ring-rose-400/70" /> заняты
              </span>
            </div>
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto bg-gradient-to-br from-slate-950 via-[#0a1224] to-indigo-950/50 p-3">
          {shootDays.map((day) => (
            <DayColumn
              key={day.id}
              day={day}
              canWrite={canWrite}
              onMenu={(dayId, anchor) => setMenuState({ dayId, anchor })}
              onOpenScene={setDetailScene}
              planningHint={hintForDay(day)}
              dayGroupBy={dayGroupBy}
              characterToActor={characterToActor}
              actorNames={actorNames}
            />
          ))}
          {shootDays.length === 0 ? (
            <p className="p-4 text-sm text-[var(--muted-fg)]">
              Создайте съёмочные дни, чтобы начать планирование.
            </p>
          ) : null}
          </div>
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
