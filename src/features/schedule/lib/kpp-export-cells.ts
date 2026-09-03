import type { ProjectType } from "@prisma/client";
import type { CellRichTextValue } from "exceljs";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import type {
  KppExportDay,
  KppExportScene,
  KppExportSlot,
} from "@/features/schedule/lib/kpp-export-data";
import {
  isKppResourceField,
} from "@/features/schedule/lib/kpp-export-fields";
import { parseResourceColumnId } from "@/features/script/lib/libretto-fields";
import {
  dayNightLabels,
  formatSecondsMmSs,
  intExtLabels,
  sceneStatusLabels,
  shootDayTypeLabels,
} from "@/shared/i18n/domain-labels";
import { formatDateShort } from "@/shared/i18n/format-date";

const CELL_FONT = { name: "Calibri", size: 11 } as const;

export type KppFullRow =
  | {
      kind: "scene";
      day: KppExportDay;
      scene: KppExportScene;
      linkNotes: string | null;
    }
  | {
      kind: "break";
      day: KppExportDay;
      slot: KppExportSlot;
    };

export type KppShortRow = {
  day: KppExportDay;
};

function formatSceneNumber(
  scene: KppExportScene,
  projectType: ProjectType,
): string {
  const num = `${scene.number}${scene.postfix || ""}`;
  if (projectType === "SERIES" && scene.episodeNumber > 0) {
    return `${scene.episodeNumber}-${num}`;
  }
  return num;
}

function formatLocation(scene: KppExportScene): string {
  const loc = scene.locations[0]?.location;
  if (!loc) return "—";
  return loc.sublocation ? `${loc.name}.${loc.sublocation}` : loc.name;
}

function formatCharacters(scene: KppExportScene): string {
  return scene.characters.map((c) => c.character.name).join(", ") || "—";
}

function resourceCell(scene: KppExportScene, categoryId: string): string {
  const links = scene.resourceItems.filter(
    (l) => l.item.category.id === categoryId,
  );
  if (links.length === 0) return "—";
  return links
    .map((l) =>
      l.quantity > 1 ? `${l.item.name} ×${l.quantity}` : l.item.name,
    )
    .join(", ");
}

function weekdayLabel(date: Date): string {
  return new Date(date).toLocaleDateString("ru-RU", {
    weekday: "short",
    timeZone: "UTC",
  });
}

function formatDateCell(date: Date, withWeekday: boolean): string {
  const base = formatDateShort(date, { utc: true });
  if (!withWeekday) return base;
  return `${weekdayLabel(date)}, ${base}`;
}

export function buildFullRowsForDay(
  day: KppExportDay,
  includeBreaks: boolean,
): KppFullRow[] {
  if (!includeBreaks) {
    return day.scenes.map((row) => ({
      kind: "scene" as const,
      day,
      scene: row.scene,
      linkNotes: row.notes,
    }));
  }

  const emitted = new Set<string>();
  const rows: KppFullRow[] = [];

  for (const slot of day.timeSlots) {
    if (slot.slotType === "SHOOTING" && slot.sceneId) {
      const found =
        day.scenes.find((s) => s.scene.id === slot.sceneId) ?? null;
      if (found && !emitted.has(found.scene.id)) {
        emitted.add(found.scene.id);
        rows.push({
          kind: "scene",
          day,
          scene: found.scene,
          linkNotes: found.notes,
        });
      }
      continue;
    }
    if (slot.slotType !== "SHOOTING") {
      rows.push({ kind: "break", day, slot });
    }
  }

  for (const link of day.scenes) {
    if (emitted.has(link.scene.id)) continue;
    rows.push({
      kind: "scene",
      day,
      scene: link.scene,
      linkNotes: link.notes,
    });
  }

  return rows;
}

export function getKppFullCellValue(
  row: KppFullRow,
  fieldId: string,
  projectType: ProjectType,
  opts: { showWeekday: boolean },
): string {
  const day = row.day;

  if (fieldId === "dayNumber") return String(day.dayNumber);
  if (fieldId === "date") return formatDateCell(day.date, opts.showWeekday);
  if (fieldId === "dayType") {
    return (
      shootDayTypeLabels[day.dayType as keyof typeof shootDayTypeLabels] ??
      day.dayType
    );
  }
  if (fieldId === "isNightShift") return day.isNightShift ? "да" : "нет";
  if (fieldId === "callTime") return day.callTime ?? "—";
  if (fieldId === "wrapTime") return day.wrapTime ?? "—";
  if (fieldId === "comment") return day.comment ?? "—";

  if (row.kind === "break") {
    if (fieldId === "breakLabel") {
      return (
        timeSlotTypeLabels[row.slot.slotType as keyof typeof timeSlotTypeLabels] ??
        row.slot.slotType
      );
    }
    if (fieldId === "breakTime") {
      return [row.slot.startTime, row.slot.endTime].filter(Boolean).join("–") || "—";
    }
    if (fieldId === "sceneNumber") {
      return (
        timeSlotTypeLabels[row.slot.slotType as keyof typeof timeSlotTypeLabels] ??
        "Перерыв"
      );
    }
    if (fieldId === "summary" || fieldId === "title") {
      return row.slot.notes ?? "—";
    }
    return "—";
  }

  const scene = row.scene;
  switch (fieldId) {
    case "sceneNumber":
      return formatSceneNumber(scene, projectType);
    case "location":
      return formatLocation(scene);
    case "intExt":
      return scene.intExt
        ? intExtLabels[scene.intExt as keyof typeof intExtLabels] ?? scene.intExt
        : "—";
    case "dayNight":
      return scene.dayNight
        ? dayNightLabels[scene.dayNight as keyof typeof dayNightLabels] ??
          scene.dayNight
        : "—";
    case "characters":
      return formatCharacters(scene);
    case "planSeconds":
      return scene.planSeconds != null && scene.planSeconds > 0
        ? formatSecondsMmSs(scene.planSeconds)
        : "—";
    case "pageCount":
      return scene.pageCount != null && scene.pageCount > 0
        ? String(scene.pageCount)
        : "—";
    case "status":
      return (
        sceneStatusLabels[scene.status as keyof typeof sceneStatusLabels] ??
        scene.status
      );
    case "title":
      return scene.title ?? "—";
    case "summary":
      return scene.summary ?? "—";
    case "scriptDay":
      return scene.scriptDay != null ? String(scene.scriptDay) : "—";
    case "breakLabel":
    case "breakTime":
      return "—";
    default: {
      if (isKppResourceField(fieldId)) {
        const catId = parseResourceColumnId(fieldId);
        return catId ? resourceCell(scene, catId) : "—";
      }
      return "—";
    }
  }
}

export function getKppShortCellValue(
  row: KppShortRow,
  fieldId: string,
  opts: { showWeekday: boolean },
): string {
  const day = row.day;
  const scenes = day.scenes.map((s) => s.scene);

  if (fieldId === "dayNumber") return String(day.dayNumber);
  if (fieldId === "date") return formatDateCell(day.date, opts.showWeekday);
  if (fieldId === "weekday") return weekdayLabel(day.date);
  if (fieldId === "dayType") {
    return (
      shootDayTypeLabels[day.dayType as keyof typeof shootDayTypeLabels] ??
      day.dayType
    );
  }
  if (fieldId === "isNightShift") return day.isNightShift ? "да" : "нет";
  if (fieldId === "comment") return day.comment ?? "—";
  if (fieldId === "sceneCount") return String(scenes.length);

  if (fieldId === "locations") {
    const set = new Set<string>();
    for (const scene of scenes) {
      for (const link of scene.locations) {
        const loc = link.location;
        set.add(
          loc.sublocation ? `${loc.name}.${loc.sublocation}` : loc.name,
        );
      }
    }
    return [...set].join(", ") || "—";
  }

  if (fieldId === "characters") {
    const set = new Set<string>();
    for (const scene of scenes) {
      for (const link of scene.characters) set.add(link.character.name);
    }
    return [...set].join(", ") || "—";
  }

  if (fieldId === "planSeconds") {
    const total = scenes.reduce((s, sc) => s + (sc.planSeconds ?? 0), 0);
    return total > 0 ? formatSecondsMmSs(total) : "—";
  }

  if (fieldId === "pageCount") {
    const total = scenes.reduce((s, sc) => s + (sc.pageCount ?? 0), 0);
    return total > 0 ? String(total) : "—";
  }

  return "—";
}

function isEmpty(value: string) {
  return !value || value === "—";
}

export function buildKppExportCell(
  values: { label: string; value: string }[],
  multiField: boolean,
): string | CellRichTextValue {
  const filled = values.filter((v) => !isEmpty(v.value));
  if (filled.length === 0) return "—";
  if (!multiField || values.length === 1) return filled[0]!.value;

  const richText: CellRichTextValue["richText"] = [];
  for (let i = 0; i < filled.length; i++) {
    if (i > 0) richText.push({ text: "\n", font: { ...CELL_FONT } });
    richText.push({
      font: { ...CELL_FONT, bold: true },
      text: `${filled[i]!.label}: `,
    });
    richText.push({ font: { ...CELL_FONT }, text: filled[i]!.value });
  }
  return { richText };
}
