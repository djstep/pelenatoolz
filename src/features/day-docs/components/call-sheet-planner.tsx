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
  cascadeDayPlan,
  durationFromSlotTimes,
  sceneDurationFromPlanSeconds,
  type DayPlanBreakItem,
  type DayPlanItem,
  type DayPlanSceneItem,
} from "@/features/day-docs/lib/compute-day-plan";
import { minutesToDurationHhMm } from "@/features/day-docs/lib/compute-call-timings";
import { formatSceneLine } from "@/features/day-docs/lib/build-day-doc";
import type { DayDocBundle } from "@/features/day-docs/lib/build-day-doc";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import { scenePrimaryAddress } from "@/features/day-docs/lib/travel-time";
import { normalizeHhMm } from "@/features/day-docs/lib/time-utils";
import { CallSheetToolbar } from "@/features/day-docs/components/call-sheet-toolbar";
import { reorderScenesAction } from "@/features/schedule/actions";
import { Button } from "@/shared/ui/button";
import { HhMmInput, isValidHhMm } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";
import { useActionToast } from "@/shared/ui/toast";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function buildInitialPlan(day: DayDocBundle["day"]): DayPlanItem[] {
  if (day.timeSlots.length > 0) {
    const items: DayPlanItem[] = [];
    for (const slot of day.timeSlots) {
      if (slot.slotType === "SHOOTING" && slot.sceneId) {
        const assignment = day.scenes.find((s) => s.scene.id === slot.sceneId);
        if (!assignment) continue;
        items.push({
          kind: "scene",
          id: `scene-${slot.sceneId}`,
          assignmentId: assignment.id,
          sceneId: slot.sceneId,
          label: formatSceneLine(assignment.scene),
          duration:
            slot.startTime && slot.endTime
              ? durationFromSlotTimes(slot.startTime, slot.endTime)
              : sceneDurationFromPlanSeconds(assignment.scene.planSeconds),
        });
      } else if (slot.slotType !== "SHOOTING") {
        items.push({
          kind: "break",
          id: `break-${slot.id}`,
          slotType: slot.slotType,
          label: slot.notes?.trim() || timeSlotTypeLabels[slot.slotType],
          duration:
            slot.startTime && slot.endTime
              ? durationFromSlotTimes(slot.startTime, slot.endTime)
              : "00:30",
          notes: slot.notes ?? "",
        });
      }
    }
    if (items.length > 0) return items;
  }

  return day.scenes.map((row) => ({
    kind: "scene" as const,
    id: `scene-${row.scene.id}`,
    assignmentId: row.id,
    sceneId: row.scene.id,
    label: formatSceneLine(row.scene),
    duration: sceneDurationFromPlanSeconds(row.scene.planSeconds),
  }));
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
          <p className="truncate pt-1.5 text-sm font-medium">Сцена · {item.label}</p>
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

      {item.kind === "break" ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-1"
          disabled={disabled}
          onClick={() => onRemove(item.id)}
          aria-label="Удалить перерыв"
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
        "rounded-xl border border-[var(--border)] bg-black/15 p-3",
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
        "rounded-xl border border-[var(--border)] bg-black/15 p-3",
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
    <div className="space-y-2 rounded-xl border border-[var(--border)] bg-black/10 p-3">
      <p className="text-xs font-medium text-[var(--muted-fg)]">
        Шаблоны перерывов (добавление / изменение / удаление)
      </p>
      {presets.map((preset) => (
        <div
          key={preset.id}
          className="grid gap-2 rounded-lg border border-[var(--border)]/60 bg-black/10 p-2 sm:grid-cols-[1fr_10rem_6rem_auto]"
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
  const [shiftStart, setShiftStart] = useState(
    day.shiftStartTime ?? day.callTime ?? "08:00",
  );
  const [presets, setPresets] = useState<BreakPreset[]>([]);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [message, setMessage] = useState<CallSheetActionState>({});
  const [pending, startTransition] = useTransition();
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

  const preview = useMemo(
    () => (isValidHhMm(shiftStart) ? cascadeDayPlan(shiftStart, plan) : []),
    [shiftStart, plan],
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

    startTransition(async () => {
      const assignmentIds = plan
        .filter((item): item is DayPlanSceneItem => item.kind === "scene")
        .map((item) => item.assignmentId);

      if (assignmentIds.length > 0) {
        try {
          await reorderScenesAction(projectId, dayId, assignmentIds);
        } catch {
          setMessage({ error: "Не удалось сохранить порядок сцен" });
          return;
        }
      }

      const normalizedPlan = plan.map((item) => ({
        ...item,
        duration: normalizeHhMm(item.duration),
      }));

      const slots = cascadeDayPlan(normalizedShift, normalizedPlan);
      const fd = new FormData();
      fd.set(
        "rows",
        JSON.stringify(
          slots.map((slot) => ({
            startTime: slot.startTime,
            endTime: slot.endTime,
            slotType: slot.slotType,
            sceneId: slot.sceneId,
            notes: slot.notes ?? "",
          })),
        ),
      );

      const result = await saveTimeSlotsAction(projectId, dayId, {}, fd);
      setMessage(result);
      if (!result.error) {
        setShiftStart(normalizedShift);
        setPlan(normalizedPlan);
      }
    });
  }

  async function insertTravelBreaks() {
    if (planLocked) return;
    const sceneById = new Map(day.scenes.map((row) => [row.scene.id, row.scene]));
    setTravelPending(true);
    try {
      const next: DayPlanItem[] = [];
      for (let i = 0; i < plan.length; i++) {
        const item = plan[i]!;
        next.push(item);
        if (item.kind !== "scene") continue;
        const following = plan[i + 1];
        if (!following || following.kind !== "scene") continue;

        const fromScene = sceneById.get(item.sceneId);
        const toScene = sceneById.get(following.sceneId);
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
          label: `Переезд · ${toScene?.locations[0]?.location.name ?? "объект"}`,
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

  if (day.scenes.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-fg)]">
        В дне нет сцен — добавьте сцены в КПП, чтобы построить план.
      </p>
    );
  }

  return (
    <div className="space-y-4 print:hidden">
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
        <p className="text-sm text-amber-400/90">
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
      </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-[var(--muted-fg)]">План дня</h4>
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
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-[var(--muted-fg)]">
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
                  <span className="font-mono font-medium">
                    {slot.startTime}–{slot.endTime}
                  </span>
                  <span className="ml-2 text-[var(--muted-fg)]">
                    {timeSlotTypeLabels[slot.slotType]}
                    {slot.sceneId
                      ? ` · ${
                          day.scenes.find((s) => s.scene.id === slot.sceneId)
                            ? formatSceneLine(
                                day.scenes.find((s) => s.scene.id === slot.sceneId)!
                                  .scene,
                              )
                            : ""
                        }`
                      : slot.notes
                        ? ` · ${slot.notes}`
                        : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
