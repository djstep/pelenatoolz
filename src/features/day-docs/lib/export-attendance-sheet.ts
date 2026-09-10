import {
  buildCastForDay,
  buildPerShiftResources,
  buildResourceTables,
  type DayDocBundle,
} from "@/features/day-docs/lib/build-day-doc";
import {
  ATTENDANCE_BUILTIN_SECTIONS,
  attendanceCategorySectionId,
  parseAttendanceCategorySectionId,
  type AttendanceSheetSettings,
} from "@/features/exports/types";
import { formatDateLong, formatDateShort } from "@/shared/i18n/format-date";

export type AttendancePersonRow = {
  name: string;
  detail: string | null;
  callTime: string | null;
};

export type AttendanceSheetSection = {
  id: string;
  title: string;
  rows: AttendancePersonRow[];
};

export type AttendanceSheetModel = {
  fileBaseName: string;
  documentTitle: string;
  projectName: string;
  dateLabel: string;
  dayNumber: number;
  city: string | null;
  sections: AttendanceSheetSection[];
};

export type AttendanceResourceOption = {
  id: string;
  label: string;
  group: "builtin" | "resources";
};

export function listAttendanceResourceOptions(
  categories: { id: string; name: string; perShift: boolean }[],
): AttendanceResourceOption[] {
  const builtin: AttendanceResourceOption[] = ATTENDANCE_BUILTIN_SECTIONS.map(
    (s) => ({ id: s.id, label: s.label, group: "builtin" as const }),
  );
  const fromCatalog = categories.map((c) => ({
    id: attendanceCategorySectionId(c.id),
    label: c.perShift ? `${c.name} (посменно)` : c.name,
    group: "resources" as const,
  }));
  return [...builtin, ...fromCatalog];
}

function uniqueSheetName(base: string, used: Set<string>) {
  let name = base.slice(0, 31) || "Лист";
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let i = 2;
  while (i < 100) {
    const suffix = ` (${i})`;
    const truncated = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    if (!used.has(truncated)) {
      used.add(truncated);
      return truncated;
    }
    i += 1;
  }
  const fallback = `${base.slice(0, 28)}_${used.size}`;
  used.add(fallback);
  return fallback;
}

function buildBuiltinSection(
  id: string,
  bundle: DayDocBundle,
): AttendanceSheetSection | null {
  const resources = buildResourceTables(bundle);
  const map: Record<string, { title: string; rows: typeof resources.extras }> = {
    "scene:extras": { title: "Массовка / групповка", rows: resources.extras },
    "scene:stunts": { title: "Трюк / каскадёры", rows: resources.stunts },
    "scene:props": { title: "Реквизит", rows: resources.props },
    "scene:art": { title: "Художественный цех", rows: resources.art },
    "scene:camera": { title: "Операторская техника", rows: resources.camera },
    "scene:vehicles": { title: "Игровой транспорт", rows: resources.vehicles },
  };

  if (id === "special:transport") {
    const rows = bundle.day.transports.map((t) => ({
      name: t.name,
      detail: t.notes,
      callTime: t.callTime,
    }));
    if (rows.length === 0) return null;
    return { id, title: "Спецтранспорт", rows };
  }

  const section = map[id];
  if (!section || section.rows.length === 0) return null;
  return {
    id,
    title: section.title,
    rows: section.rows.map((r) => ({
      name: r.name,
      detail: r.sceneNumbers.length
        ? `Сц. ${r.sceneNumbers.join(", ")}`
        : null,
      callTime: r.arrival,
    })),
  };
}

function buildCategorySection(
  categoryId: string,
  categoryName: string,
  perShift: boolean,
  bundle: DayDocBundle,
): AttendanceSheetSection | null {
  if (perShift) {
    const rows = buildPerShiftResources(bundle)
      .filter((r) => r.categoryName === categoryName)
      .map((r) => ({
        name: r.itemName,
        detail: r.notes,
        callTime: r.arrival,
      }));
    if (rows.length === 0) return null;
    return { id: attendanceCategorySectionId(categoryId), title: categoryName, rows };
  }

  const catalog = buildResourceTables(bundle).catalog.find(
    (s) => s.categoryName === categoryName,
  );
  if (!catalog || catalog.rows.length === 0) return null;
  return {
    id: attendanceCategorySectionId(categoryId),
    title: categoryName,
    rows: catalog.rows.map((r) => ({
      name: r.name,
      detail: r.sceneNumbers.length
        ? `Сц. ${r.sceneNumbers.join(", ")}`
        : null,
      callTime: r.arrival,
    })),
  };
}

export function buildAttendanceSheetModel(
  bundle: DayDocBundle,
  settings: AttendanceSheetSettings,
  categories: { id: string; name: string; perShift: boolean }[],
): AttendanceSheetModel {
  const { project, day } = bundle;
  const cast = buildCastForDay(bundle);
  const usedNames = new Set<string>();

  const sections: AttendanceSheetSection[] = [];

  sections.push({
    id: "actors",
    title: uniqueSheetName("Актёры", usedNames),
    rows: cast.map((row) => ({
      name: row.actorName ?? "не назначен",
      detail: row.characterName,
      callTime: row.arrival,
    })),
  });

  sections.push({
    id: "crew",
    title: uniqueSheetName("Цеха", usedNames),
    rows: day.departmentCalls.map((d) => ({
      name: d.personName?.trim() || "—",
      detail: d.roleLabel,
      callTime: d.callTime,
    })),
  });

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const enabled = new Set(settings.resourceIds);

  for (const opt of ATTENDANCE_BUILTIN_SECTIONS) {
    if (!enabled.has(opt.id)) continue;
    const built = buildBuiltinSection(opt.id, bundle);
    if (!built) continue;
    sections.push({
      ...built,
      title: uniqueSheetName(built.title, usedNames),
    });
  }

  for (const id of settings.resourceIds) {
    const categoryId = parseAttendanceCategorySectionId(id);
    if (!categoryId) continue;
    const cat = categoryById.get(categoryId);
    if (!cat) continue;
    const built = buildCategorySection(cat.id, cat.name, cat.perShift, bundle);
    if (!built) continue;
    sections.push({
      ...built,
      title: uniqueSheetName(built.title, usedNames),
    });
  }

  const dateLabel = formatDateLong(day.date);
  const fileBaseName = `attendance-day-${day.dayNumber}-${formatDateShort(day.date, { utc: true }).replace(/\s/g, "-")}`;

  return {
    fileBaseName,
    documentTitle: `Явочный лист · День ${day.dayNumber}`,
    projectName: project.fullName || project.name,
    dateLabel,
    dayNumber: day.dayNumber,
    city: project.city,
    sections,
  };
}
