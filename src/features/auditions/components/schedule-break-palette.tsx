"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { TimeSlotType } from "@prisma/client";
import { useEffect, useState } from "react";
import {
  DEFAULT_BREAK_PRESETS,
  loadBreakPresets,
  newBreakPresetId,
  saveBreakPresets,
  type BreakPreset,
} from "@/features/day-docs/lib/break-presets";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import { Button } from "@/shared/ui/button";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";

function BreakPresetChip({
  preset,
  canWrite,
}: {
  preset: BreakPreset;
  canWrite: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `break-preset-${preset.id}`,
      data: {
        breakPreset: {
          slotType: preset.slotType,
          label: preset.label,
          duration: preset.defaultDuration,
        },
      },
      disabled: !canWrite,
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      className={cn(
        "rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-left text-xs",
        canWrite && "cursor-grab active:cursor-grabbing hover:border-[var(--accent)]",
        isDragging && "z-20 shadow-lg",
      )}
      {...listeners}
      {...attributes}
    >
      <span className="font-medium text-[var(--foreground)]">{preset.label}</span>
      <span className="mt-0.5 block text-[10px] text-[var(--muted-fg)]">
        {preset.defaultDuration}
      </span>
    </button>
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
    <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3">
      <p className="text-xs font-medium text-[var(--muted-fg)]">
        Шаблоны перерывов (как в конструкторе КПП)
      </p>
      {presets.map((preset) => (
        <div
          key={preset.id}
          className="grid gap-2 rounded-lg border border-[var(--border)]/60 p-2 sm:grid-cols-[1fr_10rem_6rem_auto]"
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
              updatePreset(preset.id, {
                slotType: e.target.value as TimeSlotType,
              })
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

export function ScheduleBreakPalette({
  projectId,
  canWrite,
}: {
  projectId: string;
  canWrite: boolean;
}) {
  const [presets, setPresets] = useState<BreakPreset[]>(DEFAULT_BREAK_PRESETS);
  const [presetsOpen, setPresetsOpen] = useState(false);

  useEffect(() => {
    setPresets(loadBreakPresets(projectId));
  }, [projectId]);

  useEffect(() => {
    saveBreakPresets(projectId, presets);
  }, [projectId, presets]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">Технические перерывы</h4>
          <p className="text-xs text-[var(--muted-fg)]">
            Перетащите на шкалу времени
          </p>
        </div>
        {canWrite ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setPresetsOpen((v) => !v)}
          >
            {presetsOpen ? "Скрыть шаблоны" : "Настроить"}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <BreakPresetChip
            key={preset.id}
            preset={preset}
            canWrite={canWrite}
          />
        ))}
      </div>
      {presetsOpen && canWrite ? (
        <BreakPresetsEditor presets={presets} onChange={setPresets} />
      ) : null}
    </div>
  );
}

export type BreakDragPayload = {
  slotType: TimeSlotType;
  label: string;
  duration: string;
};
