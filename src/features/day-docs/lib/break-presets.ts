import type { TimeSlotType } from "@prisma/client";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";

export type BreakPreset = {
  id: string;
  slotType: TimeSlotType;
  label: string;
  defaultDuration: string;
  builtin: boolean;
};

export const DEFAULT_BREAK_PRESETS: BreakPreset[] = [
  {
    id: "builtin-makeup",
    slotType: "MAKEUP_COSTUME",
    label: timeSlotTypeLabels.MAKEUP_COSTUME,
    defaultDuration: "00:30",
    builtin: true,
  },
  {
    id: "builtin-rehearsal",
    slotType: "REHEARSAL",
    label: timeSlotTypeLabels.REHEARSAL,
    defaultDuration: "00:30",
    builtin: true,
  },
  {
    id: "builtin-lunch",
    slotType: "LUNCH",
    label: timeSlotTypeLabels.LUNCH,
    defaultDuration: "01:00",
    builtin: true,
  },
  {
    id: "builtin-travel",
    slotType: "TRAVEL",
    label: timeSlotTypeLabels.TRAVEL,
    defaultDuration: "00:30",
    builtin: true,
  },
  {
    id: "builtin-idle",
    slotType: "IDLE",
    label: timeSlotTypeLabels.IDLE,
    defaultDuration: "00:30",
    builtin: true,
  },
];

const STORAGE_PREFIX = "filmprod-break-presets";

export function loadBreakPresets(projectId: string): BreakPreset[] {
  if (typeof window === "undefined") return DEFAULT_BREAK_PRESETS;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}:${projectId}`);
    if (!raw) return DEFAULT_BREAK_PRESETS;
    const stored = JSON.parse(raw) as BreakPreset[];
    return stored.length > 0 ? stored : DEFAULT_BREAK_PRESETS;
  } catch {
    return DEFAULT_BREAK_PRESETS;
  }
}

export function saveBreakPresets(projectId: string, presets: BreakPreset[]) {
  localStorage.setItem(`${STORAGE_PREFIX}:${projectId}`, JSON.stringify(presets));
}

export function newBreakPresetId() {
  return `custom-${Math.random().toString(36).slice(2, 10)}`;
}
