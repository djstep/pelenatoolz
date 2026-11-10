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
import { MoreVertical } from "lucide-react";
import {
  assignSceneToDayByDnDAction,
  getSceneDayRemoveImpactAction,
  removeSceneFromDayAction,
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
import { SceneNumber } from "@/shared/ui/scene-number";
import { Select } from "@/shared/ui/select";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { useToast } from "@/shared/ui/toast";
import {
  computeDaySceneHints,
  computePlanningHint,
  planningHintWords,
  resolveRowIdByActor,
} from "@/features/actor-availability/lib/planning-hint";
import type { PlanningHint } from "@/features/actor-availability/lib/status";
import type { ScheduleAvailabilityBundle } from "@/features/actor-availability/lib/serialize-bundle";
import { isWorkingShootDay } from "@/features/schedule/lib/shoot-day-type";
import { formatDateShort } from "@/shared/i18n/format-date";
import { cn } from "@/shared/lib/cn";
import { locationObjectName } from "@/features/locations/lib/format-location";

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
  hint,
}: {
  row: DayScene;
  canWrite: boolean;
  onOpen: (scene: SceneCard) => void;
  /** Занятость актёров сцены в этот день (только карточки в днях). */
  hint?: PlanningHint;
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
        isDragging && "opacity-50",
        row.scene.cutAt && !isDragging && "opacity-60",
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
      <SceneCardBody scene={row.scene} hint={hint} />
    </div>
  );
}

/**
 * Цвета типов дней — переменные темы (globals.css, --kpp-*): шапка залита цветом типа,
 * сцены — в «утопленном» лотке, метка типа — сплошная плашка.
 */
function dayTypeTone(dayType: keyof typeof shootDayTypeLabels) {
  switch (dayType) {
    case "OFF":
      return {
        column: "border-[var(--kpp-off-border)]",
        head: "bg-[var(--kpp-off-head)]",
        well: "border-[var(--kpp-off-border)] bg-[var(--kpp-off-well)]",
        tag: "bg-[var(--kpp-off-tag-bg)] text-[var(--kpp-off-tag-fg)]",
      };
    case "REST":
      return {
        column: "border-[var(--kpp-rest-border)]",
        head: "bg-[var(--kpp-rest-head)]",
        well: "border-[var(--kpp-rest-border)] bg-[var(--kpp-rest-well)]",
        tag: "bg-[var(--kpp-rest-tag-bg)] text-[var(--kpp-rest-tag-fg)]",
      };
    case "PREP":
      return {
        column: "border-[var(--kpp-prep-border)]",
        head: "bg-[var(--kpp-prep-head)]",
        well: "border-[var(--kpp-prep-border)] bg-[var(--kpp-prep-well)]",
        tag: "bg-[var(--kpp-prep-tag-bg)] text-[var(--kpp-prep-tag-fg)]",
      };
    default:
      return {
        column: "border-[var(--kpp-work-border)]",
        head: "bg-[var(--kpp-work-head)]",
        well: "border-[var(--kpp-work-border)] bg-[var(--kpp-work-well)]",
        tag: "bg-[var(--kpp-work-tag-bg)] text-[var(--kpp-work-tag-fg)]",
      };
  }
}

/** Номер сцены, как в `formatSceneBrief`: серия-номер+постфикс. */
function sceneNumberLabel(scene: SceneCard) {
  const ep = scene.episodeNumber && scene.episodeNumber > 0 ? `${scene.episodeNumber}-` : "";
  return `${ep}${scene.number}${scene.postfix ?? ""}`;
}

/** Точка цветом --kpp-avail-*, слово — цветом тона (контраст текста ≥ 4.5:1 на карточке). */
const AVAILABILITY_MARK: Partial<Record<PlanningHint, { dot: string; word: string }>> = {
  all_free: { dot: "bg-[var(--kpp-avail-ok)]", word: "text-[var(--tone-success)]" },
  partial: { dot: "bg-[var(--kpp-avail-part)]", word: "text-[var(--tone-warning)]" },
  none_free: { dot: "bg-[var(--kpp-avail-busy)]", word: "text-[var(--tone-danger)]" },
};

/**
 * Карточка: «хлопушка» с номером + режим; объект; персонажи; внизу — страницы, хрон, день
 * по сценарию и (в днях) занятость актёров.
 */
function SceneCardBody({ scene, hint }: { scene: SceneCard; hint?: PlanningHint }) {
  const chars = scene.characters.map((c) => c.character.name).join(", ");
  const mode = [
    scene.intExt ? intExtLabels[scene.intExt] : null,
    scene.dayNight ? dayNightLabels[scene.dayNight] : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const firstLocation = scene.locations?.[0]?.location;
  const location = firstLocation ? locationObjectName(firstLocation) : undefined;
  const mark = hint ? AVAILABILITY_MARK[hint] : undefined;
  return (
    <>
      {scene.cutAt ? (
        <div className="mb-1">
          <Badge>вырезана</Badge>
        </div>
      ) : null}
      <div className={cn("flex items-center gap-1.5", scene.cutAt && "line-through")}>
        <SceneNumber>{sceneNumberLabel(scene)}</SceneNumber>
        {mode ? <span className="truncate text-[var(--muted-fg)]">{mode}</span> : null}
      </div>
      {location ? (
        <div className={cn("mt-1 text-[13px] font-[650] leading-snug", scene.cutAt && "line-through")}>
          {location}
        </div>
      ) : null}
      {chars ? (
        <div className="mt-0.5 line-clamp-2 text-[var(--muted-fg)]">{chars}</div>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 border-t border-[var(--border)] pt-1.5 tabular-nums text-[var(--muted-fg)]">
        <span>
          {formatPagesMinutes(scene.pageCount, scene.planSeconds)}
          {scene.scriptDay != null ? ` · день #${scene.scriptDay}` : ""}
        </span>
        {hint && mark ? (
          <span className={cn("inline-flex items-center gap-1 font-semibold", mark.word)}>
            <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", mark.dot)} />
            {planningHintWords[hint]}
          </span>
        ) : null}
      </div>
    </>
  );
}

/** Карточка сцены приподнята над лотком: рамка, тень, при наведении — выше на 1 px. */
function sceneCardClass(isDragging?: boolean) {
  return cn(
    "rounded-lg border border-[var(--kpp-card-border)] bg-[var(--kpp-card-bg)] p-2 text-xs text-[var(--foreground)]",
    "[box-shadow:var(--kpp-card-shadow)] transition-[box-shadow,transform] duration-150",
    "hover:-translate-y-px hover:[box-shadow:var(--kpp-card-shadow-hover)]",
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
        "rounded-md px-2 py-1 text-[11px] font-bold leading-snug",
        mode === "location"
          ? "bg-[var(--kpp-day-group-loc-bg)] text-[var(--kpp-day-group-loc-fg)]"
          : "bg-[var(--kpp-day-group-actor-bg)] text-[var(--kpp-day-group-actor-fg)]",
      )}
    >
      {label}
    </div>
  );
}

/** Подсказка планирования (занятость актёров) — кольцо колонки цветом --kpp-avail-*. */
const planningHintRing: Record<PlanningHint, string> = {
  all_free: "ring-2 ring-[var(--kpp-avail-ok)]",
  partial: "ring-2 ring-[var(--kpp-avail-part)]",
  none_free: "ring-2 ring-[var(--kpp-avail-busy)]",
  neutral: "",
};

function DayColumn({
  day,
  canWrite,
  onMenu,
  onOpenScene,
  planningHint,
  sceneHints,
  dayGroupBy,
  characterToActor,
  actorNames,
}: {
  day: ShootDay;
  canWrite: boolean;
  onMenu: (dayId: string, anchor: MenuAnchor) => void;
  onOpenScene: (scene: SceneCard) => void;
  planningHint?: PlanningHint;
  /** Занятость по сценам дня: id записи сцены в дне → подсказка. */
  sceneHints?: Map<string, PlanningHint>;
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
  // Заметка подготовки и комментарий — одной строкой в шапке, целиком — в подсказке.
  const note = [day.dayType === "PREP" ? day.prepNote : null, day.comment]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      ref={columnRef}
      className={cn(
        "flex h-full w-[204px] shrink-0 flex-col overflow-hidden rounded-xl border",
        tone.column,
        isOver && acceptsScenes && "ring-2 ring-[var(--accent)]",
        planningHint && planningHint !== "neutral" && planningHintRing[planningHint],
      )}
    >
      {/* Шапка дня фиксированной высоты: все колонки ровно. */}
      <div className={cn("flex h-[136px] shrink-0 flex-col gap-[3px] overflow-hidden px-3 pb-2 pt-2.5 text-[var(--kpp-head-fg)]", tone.head)}>
        <div className="flex items-start justify-between gap-1">
          <div className="text-[15px] font-bold leading-tight">День {day.dayNumber}</div>
          {canWrite ? (
            <button
              type="button"
              className="-mr-1 -mt-0.5 rounded-md p-0.5 text-[var(--kpp-head-fg-2)] hover:bg-[rgb(var(--tint-rgb)/0.1)] hover:text-[var(--kpp-head-fg)]"
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
              <MoreVertical className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="text-xs leading-tight text-[var(--kpp-head-fg-2)]">{dateStr}</div>
        <div className="flex flex-wrap gap-1">
          <span className={cn("rounded-[5px] px-1.5 py-px text-[11px] font-semibold", tone.tag)}>
            {shootDayTypeLabels[day.dayType]}
          </span>
          {day.isNightShift ? (
            <span className="rounded-[5px] bg-[var(--primary)] px-1.5 py-px text-[11px] font-semibold text-[var(--primary-fg)]">
              ночь
            </span>
          ) : null}
          {day.isLocked ? (
            <span className="rounded-[5px] border border-[var(--kpp-head-fg)] px-1.5 text-[11px] font-semibold">
              Зафиксирован
            </span>
          ) : null}
        </div>
        <div className="text-[11px] tabular-nums text-[var(--kpp-head-fg-2)]">
          {formatDaySummary(summary)}
        </div>
        {note ? (
          <p className="truncate text-[11px] text-[var(--kpp-head-fg-2)]" title={note}>
            {note}
          </p>
        ) : null}
      </div>
      {/* Лоток со сценами: утопленный, прокрутка внутри колонки. */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto border-t p-2 [box-shadow:var(--kpp-well-shadow)]",
          tone.well,
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
                hint={sceneHints?.get(block.row.id)}
              />
            ),
          )}
        </SortableContext>
        {day.scenes.length === 0 ? (
          <p
            className={cn(
              "py-6 text-center text-[11px] text-[var(--kpp-head-fg-2)]",
              acceptsScenes && "rounded-lg border border-dashed border-[var(--kpp-drop-border)]",
            )}
          >
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
    const names = scene.locations.map((l) => locationObjectName(l.location));
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
      ...scene.locations.map((l) => locationObjectName(l.location)),
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
  const toast = useToast();
  const confirm = useConfirm();
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
        set.add(locationObjectName(link.location));
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

  // Занятость на карточках в днях — одним расчётом на всю доску, из того же набора данных.
  const sceneHints = useMemo(
    () =>
      availContext
        ? computeDaySceneHints(
            shootDays,
            availContext.characterToActor,
            availContext.manualDays,
            availContext.rowIdByActor,
          )
        : undefined,
    [shootDays, availContext],
  );

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
      const result = await assignSceneToDayByDnDAction(projectId, shootDayId, sceneId);
      if (result?.error) toast.error(result.error);
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
  const detailDay = detailScene
    ? shootDays.find((d) => d.scenes.some((s) => s.scene.id === detailScene.id))
    : undefined;

  function removeFromDay(day: ShootDay, scene: SceneCard) {
    setDetailScene(null);
    void confirm({
      title: `Убрать сцену ${formatSceneBrief(scene)} из дня ${day.dayNumber}?`,
      details: () => getSceneDayRemoveImpactAction(projectId, day.id, scene.id),
      confirmLabel: "Убрать из дня",
      tone: "primary",
      action: async () => {
        const result = await removeSceneFromDayAction(projectId, day.id, scene.id);
        if (result.error) return result.error;
      },
    });
  }

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
      <div className="flex h-full min-h-[28rem] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--kpp-board-bg)] shadow-[var(--glass-shadow)]">
        <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-r border-[var(--kpp-panel-border)] bg-[var(--kpp-panel-head-bg)]">
          <div className="border-b border-[var(--kpp-panel-border)] bg-[var(--kpp-panel-head-bg)] p-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[15px] font-bold leading-snug text-[var(--kpp-panel-title)]">
                Неспланированные сцены
              </h3>
              <button
                type="button"
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-[var(--kpp-panel-fg)] hover:bg-[var(--kpp-panel-btn-hover)]",
                  (filtersOpen || hasActiveFilters) &&
                    "bg-[var(--kpp-panel-btn-active)] text-[var(--kpp-panel-title)]",
                )}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                Фильтры
                {hasActiveFilters ? " ·" : ""}
              </button>
            </div>
            <p className="mt-1 text-xs tabular-nums text-[var(--kpp-panel-muted)]">
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
                    className="text-[11px] text-[var(--muted-fg)] underline-offset-2 hover:text-[rgb(var(--tint-rgb))] hover:underline"
                    onClick={resetFilters}
                  >
                    Сбросить фильтры
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto bg-[var(--kpp-pool-well)] p-3 [box-shadow:var(--kpp-well-shadow)]">
            {displayBlocks.map(([loc, items]) => (
              <div key={loc || "__flat"}>
                {unscheduledGroupBy === "location" && loc ? (
                  <div className="mb-2 rounded-md bg-[var(--kpp-group-loc-bg)] px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--kpp-group-loc-fg)]">
                    {loc} ({items.length})
                  </div>
                ) : null}
                {unscheduledGroupBy === "actor" && loc ? (
                  <div className="mb-2 rounded-md bg-[var(--kpp-group-actor-bg)] px-2 py-1 text-[11px] font-bold tracking-wide text-[var(--kpp-group-actor-fg)]">
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
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border)] bg-[var(--kpp-bar-bg)] px-3 py-2 text-[11px] text-[var(--muted-fg)]">
            <label className="inline-flex items-center gap-2">
              <span className="shrink-0 text-[var(--foreground)]/80">
                Сцены в дне:
              </span>
              <select
                value={dayGroupBy}
                onChange={(e) => setDayGroupBy(e.target.value as DayGroupBy)}
                className="glass-input h-7 w-[9.5rem] shrink-0 rounded-lg px-2 text-[11px] leading-none text-[var(--foreground)]"
              >
                <option value="none">Список</option>
                <option value="location">По объекту</option>
                <option value="actor">По актёру</option>
              </select>
            </label>
            <span className="hidden h-3 w-px bg-[var(--border-strong)] sm:inline" aria-hidden />
            <span className="text-[var(--foreground)]/80">Типы дней:</span>
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-5 rounded-[3px] border border-[var(--border-strong)] bg-[var(--kpp-work-head)]" />
              {shootDayTypeLabels.WORKING}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-5 rounded-[3px] border border-[var(--border-strong)] bg-[var(--kpp-off-head)]" />
              {shootDayTypeLabels.OFF}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-5 rounded-[3px] border border-[var(--border-strong)] bg-[var(--kpp-rest-head)]" />
              {shootDayTypeLabels.REST}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-5 rounded-[3px] border border-[var(--border-strong)] bg-[var(--kpp-prep-head)]" />
              {shootDayTypeLabels.PREP}
            </span>
          </div>
          {activeScene && availContext ? (
            <div className="flex shrink-0 flex-wrap gap-3 border-b border-[var(--border)] bg-[var(--kpp-bar-bg)] px-3 py-2 text-[11px] text-[var(--muted-fg)]">
              <span>Занятость актёров сцены:</span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[var(--kpp-avail-ok)]" /> все свободны
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[var(--kpp-avail-part)]" /> частично
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[var(--kpp-avail-busy)]" /> заняты
              </span>
            </div>
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto bg-[var(--kpp-board-bg)] p-3">
          {shootDays.map((day) => (
            <DayColumn
              key={day.id}
              day={day}
              canWrite={canWrite}
              onMenu={(dayId, anchor) => setMenuState({ dayId, anchor })}
              onOpenScene={setDetailScene}
              planningHint={hintForDay(day)}
              sceneHints={sceneHints}
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
          <div className="w-[188px] rounded-lg border border-[var(--kpp-card-border)] bg-[var(--kpp-card-bg)] p-2 text-xs font-semibold text-[var(--foreground)] [box-shadow:var(--kpp-card-shadow-hover)]">
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
        dayNumber={detailDay?.dayNumber}
        onRemoveFromDay={
          canWrite && detailDay && !detailDay.isLocked && detailScene
            ? () => removeFromDay(detailDay, detailScene)
            : undefined
        }
      />
    </DndContext>
  );
}
