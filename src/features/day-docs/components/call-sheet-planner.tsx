"use client";

import { TimeSlotType } from "@prisma/client";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  saveTimeSlotsAction,
  type CallSheetActionState,
} from "@/features/day-docs/actions";
import {
  type BreakPreset,
  loadBreakPresets,
  newBreakPresetId,
  saveBreakPresets,
} from "@/features/day-docs/lib/break-presets";
import {
  buildPlanSlots,
  cascadeDayPlan,
  durationFromSlotTimes,
  sceneDurationFromPlanSeconds,
  type DayPlanBreakItem,
  type DayPlanItem,
  type DayPlanSceneItem,
  type SecondUnitRow,
} from "@/features/day-docs/lib/compute-day-plan";
import { minutesToDurationHhMm } from "@/features/day-docs/lib/compute-call-timings";
import {
  activeDayScenes,
  formatSceneLine,
  formatSceneNumber,
  slotDurationLabel,
} from "@/features/day-docs/lib/build-day-doc";
import type { DayDocBundle } from "@/features/day-docs/lib/build-day-doc";
import {
  breakFieldsFromSlot,
  continuationTitle,
  CONTINUATION_NEEDS_SCENE,
  cutSceneWarnings,
  isSceneCut,
} from "@/features/day-docs/lib/plan-rules";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import { scenePrimaryAddress } from "@/features/day-docs/lib/travel-time";
import { normalizeHhMm } from "@/features/day-docs/lib/time-utils";
import { useCallSheetRevision } from "@/features/call-sheets/components/revision-context";
import { REVISION_FIELD } from "@/features/call-sheets/lib/revision";
import { CallSheetToolbar } from "@/features/day-docs/components/call-sheet-toolbar";
import { reorderScenesAction } from "@/features/schedule/actions";
import { Button } from "@/shared/ui/button";
import { HhMmInput, isValidHhMm } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";
import { useActionToast } from "@/shared/ui/toast";
import { locationObjectName } from "@/features/locations/lib/format-location";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

type Day = DayDocBundle["day"];
type ProjectSceneOption = DayDocBundle["projectScenes"][number];

/** План основного юнита: из сохранённых строк MAIN, иначе — сцены дня. Вырезанные не берутся. */
function buildInitialPlan(day: Day): DayPlanItem[] {
  const activeScenes = activeDayScenes(day.scenes);
  const mainSlots = day.timeSlots.filter((slot) => slot.unit !== "SECOND");
  if (mainSlots.length > 0) {
    const items: DayPlanItem[] = [];
    const seen = new Set<string>();
    for (const slot of mainSlots) {
      if (slot.slotType === "SHOOTING" && slot.sceneId) {
        const assignment = activeScenes.find((s) => s.scene.id === slot.sceneId);
        if (!assignment) continue;
        // Сцена второй раз в плане — это продолжение (старые строки без отметки тоже).
        const continuation = slot.isContinuation || seen.has(slot.sceneId);
        seen.add(slot.sceneId);
        items.push({
          kind: "scene",
          id: continuation ? `cont-${slot.id}` : `scene-${slot.sceneId}`,
          assignmentId: assignment.id,
          sceneId: slot.sceneId,
          label: continuation
            ? continuationTitle(assignment.scene)
            : formatSceneLine(assignment.scene),
          duration:
            slot.startTime && slot.endTime
              ? durationFromSlotTimes(slot.startTime, slot.endTime)
              : sceneDurationFromPlanSeconds(assignment.scene.planSeconds),
          isContinuation: continuation,
        });
      } else if (slot.slotType !== "SHOOTING") {
        const fields = breakFieldsFromSlot(slot);
        items.push({
          kind: "break",
          id: `break-${slot.id}`,
          slotType: slot.slotType,
          label: fields.label,
          duration:
            slot.startTime && slot.endTime
              ? durationFromSlotTimes(slot.startTime, slot.endTime)
              : "00:30",
          notes: fields.notes,
        });
      }
    }
    if (items.length > 0) return items;
  }

  return activeScenes.map((row) => ({
    kind: "scene" as const,
    id: `scene-${row.scene.id}`,
    assignmentId: row.id,
    sceneId: row.scene.id,
    label: formatSceneLine(row.scene),
    duration: sceneDurationFromPlanSeconds(row.scene.planSeconds),
  }));
}

/** Дорожка «2-й юнит»: сохранённые строки SECOND как есть (строки только руками). */
function buildInitialSecondRows(day: Day): SecondUnitRow[] {
  return day.timeSlots
    .filter((slot) => slot.unit === "SECOND")
    .map((slot) => ({
      id: `second-${slot.id}`,
      startTime: slot.startTime,
      endTime: slot.endTime ?? "",
      slotType: slot.slotType,
      sceneId: slot.sceneId,
      isContinuation: slot.isContinuation,
      customLabel: slot.customLabel ?? "",
      notes: slot.notes ?? "",
    }));
}

function SecondUnitRowEditor({
  row,
  sceneOptions,
  savedScenes,
  onChange,
  onRemove,
  disabled,
}: {
  row: SecondUnitRow;
  sceneOptions: ProjectSceneOption[];
  /** Сцены уже сохранённых строк — чтобы назвать вырезанную. */
  savedScenes: Map<string, { number: string; postfix: string; episodeNumber: number; cutAt: Date | string | null }>;
  onChange: (id: string, patch: Partial<SecondUnitRow>) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const sceneInOptions = row.sceneId
    ? sceneOptions.some((scene) => scene.id === row.sceneId)
    : true;
  const savedScene = row.sceneId ? savedScenes.get(row.sceneId) : undefined;
  const cutScene = !sceneInOptions && savedScene && isSceneCut(savedScene) ? savedScene : null;

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] p-3",
        disabled && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex w-24 flex-col gap-1 text-xs">
          <span className="text-[var(--muted-fg)]">Начало</span>
          <HhMmInput
            value={row.startTime}
            disabled={disabled}
            onChange={(startTime) => onChange(row.id, { startTime })}
            placeholder="09:00"
          />
        </label>
        <label className="flex w-24 flex-col gap-1 text-xs">
          <span className="text-[var(--muted-fg)]">Конец</span>
          <HhMmInput
            value={row.endTime}
            disabled={disabled}
            onChange={(endTime) => onChange(row.id, { endTime })}
            placeholder="10:00"
          />
        </label>
        <div className="flex flex-col gap-1 pb-2 text-xs">
          <span className="text-[var(--muted-fg)]">Длительность</span>
          <span className="tabular-nums">
            {isValidHhMm(row.startTime) && isValidHhMm(row.endTime)
              ? slotDurationLabel(row.startTime, row.endTime)
              : "—"}
          </span>
        </div>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs">
          <span className="text-[var(--muted-fg)]">Тип</span>
          <select
            className="glass-input w-full rounded-xl px-3 py-2 text-sm"
            value={row.slotType}
            disabled={disabled}
            onChange={(e) => onChange(row.id, { slotType: e.target.value as TimeSlotType })}
          >
            {Object.entries(timeSlotTypeLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => onRemove(row.id)}
          aria-label="Удалить строку 2-го юнита"
        >
          ✕
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="text-[var(--muted-fg)]">Сцена (из либретто)</span>
          <select
            className="glass-input w-full rounded-xl px-3 py-2 text-sm"
            value={row.sceneId ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const sceneId = e.target.value || null;
              onChange(row.id, {
                sceneId,
                isContinuation: sceneId ? row.isContinuation : false,
              });
            }}
          >
            <option value="">— без сцены —</option>
            {!sceneInOptions && row.sceneId ? (
              <option value={row.sceneId} disabled>
                {savedScene ? `${formatSceneNumber(savedScene)} (вырезана)` : "Сцена не найдена"}
              </option>
            ) : null}
            {sceneOptions.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {formatSceneLine(scene)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pt-5 text-xs">
          <input
            type="checkbox"
            checked={row.isContinuation}
            disabled={disabled || !row.sceneId}
            onChange={(e) => onChange(row.id, { isContinuation: e.target.checked })}
          />
          <span>Продолжение сцены</span>
        </label>
      </div>
      {cutScene ? (
        <p className="text-xs text-[var(--danger)]">
          Сцена {formatSceneNumber(cutScene)} вырезана — выберите другую сцену или уберите строку.
        </p>
      ) : !sceneInOptions ? (
        <p className="text-xs text-[var(--danger)]">
          Сцена не найдена — выберите другую сцену или уберите строку.
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="text-[var(--muted-fg)]">Свой текст строки</span>
          <Input
            value={row.customLabel}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => onChange(row.id, { customLabel: e.target.value })}
            placeholder={timeSlotTypeLabels[row.slotType]}
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-[var(--muted-fg)]">Примечание</span>
          <Input
            value={row.notes}
            disabled={disabled}
            onChange={(e) => onChange(row.id, { notes: e.target.value })}
            placeholder="Необязательно"
          />
        </label>
      </div>
    </div>
  );
}

/** Подпись строки в предпросмотре: свой текст / «Продолжение сцены N» / тип и сцена. */
function previewSlotText(
  slot: {
    slotType: TimeSlotType;
    sceneId: string | null;
    isContinuation: boolean;
    customLabel: string | null;
    notes: string | null;
  },
  sceneById: Map<string, Parameters<typeof formatSceneLine>[0]>,
): string {
  const scene = slot.sceneId ? sceneById.get(slot.sceneId) : undefined;
  const parts: string[] = [];
  if (scene && slot.isContinuation) {
    parts.push(slot.customLabel || continuationTitle(scene));
  } else {
    parts.push(slot.customLabel || timeSlotTypeLabels[slot.slotType]);
    if (scene) parts.push(formatSceneLine(scene));
  }
  if (slot.notes) parts.push(slot.notes);
  return parts.join(" · ");
}

function PlanRowBody({
  item,
  onChange,
  onRemove,
  disabled,
  dragHandle,
}: {
  item: DayPlanItem;
  onChange: (id: string, patch: Partial<DayPlanItem>) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  dragHandle?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {dragHandle}

      <div className="min-w-0 flex-1 space-y-2">
        {item.kind === "scene" ? (
          <p className="truncate pt-1.5 text-sm font-medium">
            {item.isContinuation ? item.label : `Сцена · ${item.label}`}
          </p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="text-[var(--muted-fg)]">Тип</span>
                <select
                  className="glass-input w-full rounded-xl px-3 py-2 text-sm"
                  value={item.slotType}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange(item.id, {
                      slotType: e.target.value as TimeSlotType,
                    } as Partial<DayPlanBreakItem>)
                  }
                >
                  {Object.entries(timeSlotTypeLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="text-[var(--muted-fg)]">Название</span>
                <Input
                  value={item.label}
                  disabled={disabled}
                  onChange={(e) => onChange(item.id, { label: e.target.value })}
                />
              </label>
            </div>
            <label className="block space-y-1 text-xs">
              <span className="text-[var(--muted-fg)]">Примечание</span>
              <Input
                value={item.notes}
                disabled={disabled}
                onChange={(e) => onChange(item.id, { notes: e.target.value })}
                placeholder="Необязательно"
              />
            </label>
          </>
        )}

        <label className="flex max-w-[8rem] flex-col gap-1 text-xs">
          <span className="text-[var(--muted-fg)]">Длительность</span>
          <HhMmInput
            mode="duration"
            value={item.duration}
            disabled={disabled}
            onChange={(duration) => onChange(item.id, { duration })}
            placeholder="00:30"
          />
        </label>
      </div>

      {item.kind === "break" || item.isContinuation ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-1"
          disabled={disabled}
          onClick={() => onRemove(item.id)}
          aria-label={item.kind === "break" ? "Удалить перерыв" : "Удалить продолжение сцены"}
        >
          ✕
        </Button>
      ) : null}
    </div>
  );
}

function StaticPlanRow({
  item,
  onChange,
  onRemove,
  disabled,
}: {
  item: DayPlanItem;
  onChange: (id: string, patch: Partial<DayPlanItem>) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] p-3",
        disabled && "opacity-70",
      )}
    >
      <PlanRowBody
        item={item}
        onChange={onChange}
        onRemove={onRemove}
        disabled={disabled}
        dragHandle={
          <span
            className="mt-2 px-1 text-[var(--muted-fg)] opacity-50"
            aria-hidden
          >
            ⠿
          </span>
        }
      />
    </div>
  );
}

function SortablePlanRow({
  item,
  onChange,
  onRemove,
  disabled,
}: {
  item: DayPlanItem;
  onChange: (id: string, patch: Partial<DayPlanItem>) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, animateLayoutChanges: () => false, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--inset-bg)] p-3",
        isDragging && "z-10 opacity-80 ring-1 ring-[var(--accent)]/50",
        disabled && "opacity-70",
      )}
    >
      <PlanRowBody
        item={item}
        onChange={onChange}
        onRemove={onRemove}
        disabled={disabled}
        dragHandle={
          <button
            type="button"
            disabled={disabled}
            className="mt-2 cursor-grab touch-none px-1 text-[var(--muted-fg)] active:cursor-grabbing disabled:cursor-not-allowed"
            aria-label="Перетащить"
            {...attributes}
            {...listeners}
          >
            ⠿
          </button>
        }
      />
    </div>
  );
}

function BreakPresetsEditor({
  presets,
  onChange,
}: {
  presets: BreakPreset[];
  onChange: (next: BreakPreset[]) => void;
}) {
  function updatePreset(id: string, patch: Partial<BreakPreset>) {
    onChange(presets.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function removePreset(id: string) {
    onChange(presets.filter((p) => p.id !== id));
  }

  function addPreset() {
    onChange([
      ...presets,
      {
        id: newBreakPresetId(),
        slotType: "IDLE",
        label: "Новый перерыв",
        defaultDuration: "00:30",
        builtin: false,
      },
    ]);
  }

  return (
    <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--inset-bg-soft)] p-3">
      <p className="text-xs font-medium text-[var(--muted-fg)]">
        Шаблоны перерывов (добавление / изменение / удаление)
      </p>
      {presets.map((preset) => (
        <div
          key={preset.id}
          className="grid gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--inset-bg-soft)] p-2 sm:grid-cols-[1fr_10rem_6rem_auto]"
        >
          <Input
            value={preset.label}
            onChange={(e) => updatePreset(preset.id, { label: e.target.value })}
            placeholder="Название"
          />
          <select
            className="glass-input rounded-xl px-3 py-2 text-sm"
            value={preset.slotType}
            onChange={(e) =>
              updatePreset(preset.id, { slotType: e.target.value as TimeSlotType })
            }
          >
            {Object.entries(timeSlotTypeLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <HhMmInput
            mode="duration"
            value={preset.defaultDuration}
            onChange={(defaultDuration) =>
              updatePreset(preset.id, { defaultDuration })
            }
            placeholder="00:30"
          />
          {!preset.builtin ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => removePreset(preset.id)}
              aria-label="Удалить шаблон"
            >
              ✕
            </Button>
          ) : (
            <span className="self-center px-2 text-[10px] text-[var(--muted-fg)]">
              базовый
            </span>
          )}
        </div>
      ))}
      <Button type="button" variant="ghost" onClick={addPreset}>
        + Добавить шаблон
      </Button>
    </div>
  );
}

export function CallSheetPlanner({
  projectId,
  dayId,
  bundle,
  canEdit,
}: {
  projectId: string;
  dayId: string;
  bundle: DayDocBundle;
  canEdit: boolean;
}) {
  const { day } = bundle;
  const planLocked = day.callSheetPlanLocked;
  const [plan, setPlan] = useState<DayPlanItem[]>(() => buildInitialPlan(day));
  const [secondRows, setSecondRows] = useState<SecondUnitRow[]>(() =>
    buildInitialSecondRows(day),
  );
  const [continuationSceneId, setContinuationSceneId] = useState("");
  const [shiftStart, setShiftStart] = useState(
    day.shiftStartTime ?? day.callTime ?? "08:00",
  );
  const [presets, setPresets] = useState<BreakPreset[]>([]);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [message, setMessage] = useState<CallSheetActionState>({});
  const [pending, startTransition] = useTransition();
  const { revision, track } = useCallSheetRevision();
  const [travelPending, setTravelPending] = useState(false);
  const [dndReady, setDndReady] = useState(false);

  useActionToast(message);

  useEffect(() => {
    setDndReady(true);
  }, []);

  useEffect(() => {
    setPresets(loadBreakPresets(projectId));
  }, [projectId]);

  useEffect(() => {
    saveBreakPresets(projectId, presets);
  }, [presets, projectId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const activeScenes = useMemo(() => activeDayScenes(day.scenes), [day.scenes]);
  const cutWarnings = useMemo(() => cutSceneWarnings(day.scenes), [day.scenes]);
  /** Вырезанные сцены дня и строк плана: каскад их пропускает. */
  const cutSceneIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of day.scenes) if (isSceneCut(row.scene)) ids.add(row.scene.id);
    for (const slot of day.timeSlots) {
      if (slot.sceneId && isSceneCut(slot.scene)) ids.add(slot.sceneId);
    }
    return ids;
  }, [day.scenes, day.timeSlots]);
  /** Сцены для подписей: сцены дня, строк плана и список проекта. */
  const sceneById = useMemo(() => {
    const map = new Map<string, Parameters<typeof formatSceneLine>[0]>();
    for (const scene of bundle.projectScenes) map.set(scene.id, scene);
    for (const slot of day.timeSlots) if (slot.scene) map.set(slot.scene.id, slot.scene);
    for (const row of day.scenes) map.set(row.scene.id, row.scene);
    return map;
  }, [bundle.projectScenes, day.scenes, day.timeSlots]);
  const savedSecondScenes = useMemo(
    () =>
      new Map(
        day.timeSlots
          .filter((slot) => slot.scene)
          .map((slot) => [slot.scene!.id, slot.scene!] as const),
      ),
    [day.timeSlots],
  );

  const preview = useMemo(
    () => (isValidHhMm(shiftStart) ? cascadeDayPlan(shiftStart, plan, cutSceneIds) : []),
    [shiftStart, plan, cutSceneIds],
  );

  /** Сцены основного юнита, у которых можно добавить «Продолжение сцены». */
  const continuationOptions = useMemo(
    () =>
      plan.filter(
        (item): item is DayPlanSceneItem => item.kind === "scene" && !item.isContinuation,
      ),
    [plan],
  );

  function reorderPlan(activeId: string, overId: string) {
    setPlan((prev) => {
      const oldIndex = prev.findIndex((item) => item.id === activeId);
      const newIndex = prev.findIndex((item) => item.id === overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return prev;
      const next = [...prev];
      const [item] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, item!);
      return next;
    });
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorderPlan(String(active.id), String(over.id));
  }

  function addBreakFromPreset(preset: BreakPreset) {
    if (planLocked) return;
    const row: DayPlanBreakItem = {
      kind: "break",
      id: `break-${uid()}`,
      slotType: preset.slotType,
      label: preset.label,
      duration: preset.defaultDuration,
      notes: "",
    };
    setPlan((prev) => [...prev, row]);
  }

  function updatePlanItem(id: string, patch: Partial<DayPlanItem>) {
    setPlan((prev) =>
      prev.map((row) => (row.id === id ? ({ ...row, ...patch } as DayPlanItem) : row)),
    );
  }

  /** «Продолжение сцены N» — ещё одна строка уже стоящей в плане сцены (в конец плана). */
  function addContinuation() {
    if (planLocked) return;
    const original = continuationOptions.find((item) => item.sceneId === continuationSceneId);
    const scene = original ? sceneById.get(original.sceneId) : undefined;
    if (!original || !scene) return;
    const row: DayPlanSceneItem = {
      kind: "scene",
      id: `cont-${uid()}`,
      assignmentId: original.assignmentId,
      sceneId: original.sceneId,
      label: continuationTitle(scene),
      duration: "00:30",
      isContinuation: true,
    };
    setPlan((prev) => [...prev, row]);
  }

  function addSecondRow() {
    if (planLocked) return;
    setSecondRows((prev) => [
      ...prev,
      {
        id: `second-${uid()}`,
        startTime: prev[prev.length - 1]?.endTime || "",
        endTime: "",
        slotType: "SHOOTING",
        sceneId: null,
        isContinuation: false,
        customLabel: "",
        notes: "",
      },
    ]);
  }

  function updateSecondRow(id: string, patch: Partial<SecondUnitRow>) {
    setSecondRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function applyPlan() {
    if (planLocked) return;
    if (!isValidHhMm(shiftStart)) {
      setMessage({ error: "Начало смены: формат ЧЧ:ММ" });
      return;
    }
    const normalizedShift = normalizeHhMm(shiftStart);
    for (const item of plan) {
      if (!isValidHhMm(item.duration)) {
        setMessage({ error: `Длительность «${item.kind === "scene" ? item.label : item.label}»: формат ЧЧ:ММ` });
        return;
      }
    }
    for (const [index, row] of secondRows.entries()) {
      const name = `2-й юнит, строка ${index + 1}`;
      if (!isValidHhMm(row.startTime)) {
        setMessage({ error: `${name}: начало — в виде ЧЧ:ММ` });
        return;
      }
      if (row.endTime.trim() && !isValidHhMm(row.endTime)) {
        setMessage({ error: `${name}: конец — в виде ЧЧ:ММ` });
        return;
      }
      if (row.isContinuation && !row.sceneId) {
        setMessage({ error: `${name}: ${CONTINUATION_NEEDS_SCENE}` });
        return;
      }
    }

    startTransition(async () => {
      // Порядок сцен дня в КПП — по первому появлению сцены (продолжения не считаются).
      const assignmentIds = plan
        .filter(
          (item): item is DayPlanSceneItem =>
            item.kind === "scene" && !item.isContinuation && !cutSceneIds.has(item.sceneId),
        )
        .map((item) => item.assignmentId);

      const normalizedPlan = plan.map((item) => ({
        ...item,
        duration: normalizeHhMm(item.duration),
      }));

      // Основной юнит — каскадом, 2-й юнит — как ввели (не теряется при сохранении планера).
      const slots = buildPlanSlots(normalizedShift, normalizedPlan, secondRows, cutSceneIds);
      const fd = new FormData();
      fd.set(
        "rows",
        JSON.stringify(
          slots.map((slot) => ({
            startTime: slot.startTime,
            endTime: slot.endTime ?? "",
            slotType: slot.slotType,
            sceneId: slot.sceneId,
            notes: slot.notes ?? "",
            unit: slot.unit,
            isContinuation: slot.isContinuation,
            customLabel: slot.customLabel,
          })),
        ),
      );

      fd.set(REVISION_FIELD, revision === null ? "" : String(revision));

      // Сначала план — он сверяет номер правки и не пишет утверждённый вызывной; порядок сцен
      // в КПП — только после него, иначе отказ плана оставил бы новый порядок сцен.
      const result = track(await saveTimeSlotsAction(projectId, dayId, {}, fd));
      if (!result.error && assignmentIds.length > 0) {
        try {
          await reorderScenesAction(projectId, dayId, assignmentIds);
        } catch {
          setMessage({ error: "План сохранён, но не удалось сохранить порядок сцен" });
          return;
        }
      }
      setMessage(result);
      if (!result.error) {
        setShiftStart(normalizedShift);
        setPlan(normalizedPlan);
        setSecondRows((prev) =>
          prev.map((row) => ({
            ...row,
            startTime: normalizeHhMm(row.startTime),
            endTime: row.endTime.trim() ? normalizeHhMm(row.endTime) : "",
          })),
        );
      }
    });
  }

  async function insertTravelBreaks() {
    if (planLocked) return;
    const dayScenesById = new Map(day.scenes.map((row) => [row.scene.id, row.scene]));
    setTravelPending(true);
    try {
      const next: DayPlanItem[] = [];
      for (let i = 0; i < plan.length; i++) {
        const item = plan[i]!;
        next.push(item);
        if (item.kind !== "scene") continue;
        const following = plan[i + 1];
        if (!following || following.kind !== "scene") continue;

        const fromScene = dayScenesById.get(item.sceneId);
        const toScene = dayScenesById.get(following.sceneId);
        const from = fromScene ? scenePrimaryAddress(fromScene) : null;
        const to = toScene ? scenePrimaryAddress(toScene) : null;
        if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue;

        const res = await fetch(`/api/projects/${projectId}/routing/travel-time`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to }),
        });
        const data = (await res.json()) as { minutes?: number; error?: string };
        if (data.error) {
          setMessage({ error: data.error });
          return;
        }

        const duration = minutesToDurationHhMm(data.minutes ?? 45);
        next.push({
          kind: "break",
          id: `break-travel-${uid()}`,
          slotType: "TRAVEL",
          label: `Переезд · ${toScene?.locations[0] ? locationObjectName(toScene.locations[0].location) : "объект"}`,
          duration,
          notes: `${from} → ${to}`,
        });
      }
      setPlan(next);
      setMessage({ success: "Переезды добавлены в план" });
    } catch {
      setMessage({ error: "Не удалось рассчитать переезды" });
    } finally {
      setTravelPending(false);
    }
  }

  const cutWarningsBlock =
    cutWarnings.length > 0 ? (
      <div className="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--inset-bg-soft)] p-3 print:hidden">
        {cutWarnings.map((text) => (
          <p key={text} className="text-sm text-[var(--tone-warning-strong)]/90">
            {text}
          </p>
        ))}
      </div>
    ) : null;

  if (activeScenes.length === 0) {
    return (
      <div className="space-y-2">
        {cutWarningsBlock}
        <p className="text-sm text-[var(--muted-fg)]">
          В дне нет сцен — добавьте сцены в КПП, чтобы построить план.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 print:hidden">
      {cutWarningsBlock}
      {canEdit ? (
        <CallSheetToolbar
          projectId={projectId}
          dayId={dayId}
          planLocked={planLocked}
          savedAt={day.callSheetSavedAt}
          canEdit={canEdit}
          onInsertTravel={insertTravelBreaks}
          travelPending={travelPending}
        />
      ) : null}

      {planLocked ? (
        <p className="text-sm text-[var(--tone-warning-strong)]/90">
          План зафиксирован — снимите фиксацию, чтобы редактировать.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs">
          <span className="text-[var(--muted-fg)]">Начало смены</span>
          <HhMmInput
            value={shiftStart}
            onChange={setShiftStart}
            disabled={planLocked}
            placeholder="08:00"
            className="w-28"
          />
        </label>
        {canEdit ? (
          <Button
            type="button"
            disabled={pending || planLocked}
            onClick={() => applyPlan()}
          >
            {pending ? "Сохранение…" : "Применить к расписанию"}
          </Button>
        ) : null}
      </div>

      {canEdit ? (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted-fg)]">Добавить перерыв:</span>
          {presets.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="secondary"
              disabled={planLocked}
              onClick={() => addBreakFromPreset(preset)}
            >
              + {preset.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            disabled={planLocked}
            onClick={() => setPresetsOpen((v) => !v)}
          >
            {presetsOpen ? "Скрыть шаблоны" : "Настроить шаблоны"}
          </Button>
        </div>
        {presetsOpen && !planLocked ? (
          <BreakPresetsEditor presets={presets} onChange={setPresets} />
        ) : null}
        {continuationOptions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--muted-fg)]">Продолжение сцены:</span>
            <select
              className="glass-input rounded-xl px-3 py-2 text-sm"
              value={continuationSceneId}
              disabled={planLocked}
              onChange={(e) => setContinuationSceneId(e.target.value)}
              aria-label="Сцена для продолжения"
            >
              <option value="">— выберите сцену —</option>
              {continuationOptions.map((item) => (
                <option key={item.id} value={item.sceneId}>
                  {item.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              disabled={planLocked || !continuationSceneId}
              onClick={addContinuation}
            >
              + Продолжение
            </Button>
          </div>
        ) : null}
      </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h4 className="sheet-subhead">
            План дня — основной юнит
          </h4>
          {dndReady ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragOver={handleDragOver}
          >
            <SortableContext
              items={plan.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {plan.map((item) => (
                  <SortablePlanRow
                    key={item.id}
                    item={item}
                    disabled={planLocked || !canEdit}
                    onChange={updatePlanItem}
                    onRemove={(id) =>
                      setPlan((prev) => prev.filter((row) => row.id !== id))
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          ) : (
            <div className="space-y-2">
              {plan.map((item) => (
                <StaticPlanRow
                  key={item.id}
                  item={item}
                  disabled={planLocked || !canEdit}
                  onChange={updatePlanItem}
                  onRemove={(id) =>
                    setPlan((prev) => prev.filter((row) => row.id !== id))
                  }
                />
              ))}
            </div>
          )}

          <div className="space-y-2 pt-2">
            <h4 className="sheet-subhead">2-й юнит</h4>
            <p className="text-xs text-[var(--muted-fg)]">
              Строки 2-го юнита добавляются руками: время, тип, сцена из либретто. Время
              основного юнита их не сдвигает.
            </p>
            {secondRows.length === 0 ? (
              <p className="text-sm text-[var(--muted-fg)]">Строк нет.</p>
            ) : (
              secondRows.map((row) => (
                <SecondUnitRowEditor
                  key={row.id}
                  row={row}
                  sceneOptions={bundle.projectScenes}
                  savedScenes={savedSecondScenes}
                  disabled={planLocked || !canEdit}
                  onChange={updateSecondRow}
                  onRemove={(id) =>
                    setSecondRows((prev) => prev.filter((item) => item.id !== id))
                  }
                />
              ))
            )}
            {canEdit ? (
              <Button
                type="button"
                variant="ghost"
                disabled={planLocked}
                onClick={addSecondRow}
              >
                + Строка 2-го юнита
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="sheet-subhead">
            Предпросмотр тайминга
          </h4>
          {!isValidHhMm(shiftStart) ? (
            <p className="text-sm text-[var(--danger)]">
              Укажите начало смены в формате ЧЧ:ММ
            </p>
          ) : preview.length === 0 ? (
            <p className="text-sm text-[var(--muted-fg)]">Задайте длительности элементов.</p>
          ) : (
            <div className="space-y-2">
              {preview.map((slot, index) => (
                <div
                  key={`${slot.startTime}-${index}`}
                  className="rounded-lg border border-[var(--border)]/60 px-3 py-2 text-sm"
                >
                  <span className="tabular-nums font-medium">
                    {slot.startTime}–{slot.endTime}
                  </span>
                  <span className="ml-2 text-[var(--muted-fg)]">
                    {previewSlotText(slot, sceneById)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {secondRows.length > 0 ? (
            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium text-[var(--muted-fg)]">2-й юнит</p>
              {secondRows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border border-[var(--border)]/60 px-3 py-2 text-sm"
                >
                  <span className="tabular-nums font-medium">
                    {row.startTime || "—"}
                    {row.endTime ? `–${row.endTime}` : ""}
                  </span>
                  <span className="ml-2 text-[var(--muted-fg)]">
                    {previewSlotText(
                      {
                        slotType: row.slotType,
                        sceneId: row.sceneId,
                        isContinuation: Boolean(row.sceneId) && row.isContinuation,
                        customLabel: row.customLabel.trim() || null,
                        notes: row.notes.trim() || null,
                      },
                      sceneById,
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
