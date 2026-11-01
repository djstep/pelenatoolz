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
import { formatDateLong, formatFileDate } from "@/shared/i18n/format-date";

export type AttendancePersonRow = {
  name: string;
  detail: string | null;
  callTime: string | null;
};

export type AttendanceSheetSection = {
  id: string;
  title: string;
  rows: AttendancePersonRow[];
  /** Текст вместо строк, если их нет (по умолчанию — «Нет записей в вызывном»). */
  emptyText?: string;
};

/** Руководители и вызов цехов из вызывного дня (`CallSheetLeader`, `CallSheetCrewCall`). */
export type AttendanceCallSheetCrew = {
  leaders: { position: string; shortTitle: string | null; personName: string | null }[];
  crewCalls: { label: string; callTime: string | null }[];
};

export const ATTENDANCE_NO_CALL_SHEET = "Создайте вызывной — цеха берутся из него";
/** Строка актёрской таблицы: только то, что раздаётся на площадке — без ставок и телефонов. */
export type AttendanceActorRow = {
  /** «Фамилия Имя» */
  actor: string;
  character: string;
  /** Вызов из актёрского блока вызывного («Прибытие»). */
  callTime: string | null;
};

/** Актёрская таблица одной группы съёмки — свой лист в выгрузке. */
export type AttendanceActorTable = {
  unit: string;
  sheetName: string;
  /** «Явочный лист «Проект» 01.11.2026 · 2-й юнит» */
  title: string;
  /** «Место съёмки: адрес; адрес» */
  placeLine: string;
  rows: AttendanceActorRow[];
};

/** Колонки актёрской таблицы; после «Вызова» — пустые, заполняются ручкой. */
export const ATTENDANCE_ACTOR_COLUMNS = [
  "Актёр",
  "Персонаж",
  "Вызов",
  "Прибытие факт",
  "Конец смены",
  "Переработка",
  "Подпись",
] as const;

export type AttendanceSheetModel = {
  fileBaseName: string;
  documentTitle: string;
  projectName: string;
  dateLabel: string;
  dayNumber: number;
  city: string | null;
  actorTables: AttendanceActorTable[];
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

/**
 * Вкладка «Цеха» — из вызывного: руководители (человек, должность), затем цеха со временем
 * вызова. Старая `DepartmentCallTime` не читается.
 */
function buildCrewRows(callSheet: AttendanceCallSheetCrew): AttendancePersonRow[] {
  return [
    ...callSheet.leaders.map((row) => ({
      name: row.personName?.trim() || "—",
      detail: row.shortTitle?.trim() || row.position,
      callTime: null,
    })),
    ...callSheet.crewCalls.map((row) => ({
      name: row.label,
      detail: null,
      callTime: row.callTime,
    })),
  ];
}

export function attendanceUnitKey(unit: string | null | undefined) {
  return unit?.trim() || "main";
}

export function attendanceUnitLabel(unit: string) {
  return unit === "main" ? "Основная группа" : unit;
}

/** Основная группа первой, остальные по алфавиту — как листы групп в КПП. */
function compareUnits(a: string, b: string) {
  if (a === b) return 0;
  if (a === "main") return -1;
  if (b === "main") return 1;
  return a.localeCompare(b, "ru");
}

/** 01.11.2026 — дата дня хранится полночью по часовому поясу проекта. */
export function formatAttendanceDate(value: Date | string, timezone: string | null) {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone || "Europe/Moscow",
  });
}

/**
 * Другие дни той же даты, которые нужно добавить листами групп: по одному на каждую
 * группу, кроме группы выгружаемого дня (берётся день с меньшим номером).
 */
export function pickOtherUnitDayIds(
  currentUnit: string | null | undefined,
  sameDateDays: { id: string; unit: string | null; dayNumber: number }[],
): string[] {
  const taken = new Set([attendanceUnitKey(currentUnit)]);
  const ids: string[] = [];
  for (const d of [...sameDateDays].sort((a, b) => a.dayNumber - b.dayNumber)) {
    const key = attendanceUnitKey(d.unit);
    if (taken.has(key)) continue;
    taken.add(key);
    ids.push(d.id);
  }
  return ids;
}

/** Строки — в порядке актёрского блока вызывного (`buildCastForDay`). */
export function buildAttendanceActorRows(bundle: DayDocBundle): AttendanceActorRow[] {
  const actorById = new Map(bundle.actors.map((a) => [a.id, a] as const));
  return buildCastForDay(bundle).map((row) => {
    const actor = row.actorId ? actorById.get(row.actorId) : undefined;
    const name = actor
      ? [actor.lastName, actor.firstName].filter(Boolean).join(" ")
      : "";
    return {
      actor: name || "не назначен",
      character: row.characterName,
      callTime: row.arrival,
    };
  });
}

/** Адреса объектов дня в порядке сцен, без повторов; нет адреса — название объекта. */
export function buildAttendancePlaceLine(bundle: DayDocBundle) {
  const places: string[] = [];
  for (const row of bundle.day.scenes) {
    for (const link of row.scene.locations) {
      const place = link.location.address?.trim() || link.location.name.trim();
      if (place && !places.includes(place)) places.push(place);
    }
  }
  return `Место съёмки: ${places.length ? places.join("; ") : "—"}`;
}

/**
 * Актёрские таблицы по группам съёмки: выгружаемый день и дни других групп той же даты.
 * Группа в шапке — только если групп несколько или группа не основная.
 */
export function buildAttendanceActorTables(
  bundles: DayDocBundle[],
  usedSheetNames: Set<string> = new Set(),
): AttendanceActorTable[] {
  const byUnit = new Map<string, DayDocBundle>();
  for (const b of bundles) {
    const key = attendanceUnitKey(b.day.unit);
    if (!byUnit.has(key)) byUnit.set(key, b);
  }
  const units = [...byUnit.keys()].sort(compareUnits);
  const showUnit = units.length > 1 || units[0] !== "main";

  return units.map((unit) => {
    const b = byUnit.get(unit)!;
    const projectName = b.project.fullName || b.project.name;
    const unitLabel = attendanceUnitLabel(unit);
    const title = `Явочный лист «${projectName}» ${formatAttendanceDate(b.day.date, b.project.timezone)}${
      showUnit ? ` · ${unitLabel}` : ""
    }`;
    const sheetBase = showUnit
      ? `Актёры · ${unit === "main" ? "Основная" : unit}`
      : "Актёры";
    return {
      unit,
      sheetName: uniqueSheetName(sheetBase.replace(/[\\/*?[\]:]/g, "_"), usedSheetNames),
      title,
      placeLine: buildAttendancePlaceLine(b),
      rows: buildAttendanceActorRows(b),
    };
  });
}

export function buildAttendanceSheetModel(
  bundle: DayDocBundle,
  settings: AttendanceSheetSettings,
  categories: { id: string; name: string; perShift: boolean }[],
  /** Вызывной дня; null — ещё не создан (вкладка «Цеха» пустая с подсказкой). */
  callSheet: AttendanceCallSheetCrew | null,
  /** Дни других групп той же даты (`pickOtherUnitDayIds`). */
  otherUnitBundles: DayDocBundle[] = [],
): AttendanceSheetModel {
  const { project, day } = bundle;
  const usedNames = new Set<string>();

  const actorTables = buildAttendanceActorTables(
    [bundle, ...otherUnitBundles],
    usedNames,
  );

  const sections: AttendanceSheetSection[] = [];

  sections.push({
    id: "crew",
    title: uniqueSheetName("Цеха", usedNames),
    rows: callSheet ? buildCrewRows(callSheet) : [],
    ...(callSheet ? {} : { emptyText: ATTENDANCE_NO_CALL_SHEET }),
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
  const fileBaseName = `attendance-day-${day.dayNumber}-${formatFileDate(day.date, project.timezone)}`;

  return {
    fileBaseName,
    documentTitle: `Явочный лист · День ${day.dayNumber}`,
    projectName: project.fullName || project.name,
    dateLabel,
    dayNumber: day.dayNumber,
    city: project.city,
    actorTables,
    sections,
  };
}
