import { z } from "zod";
import {
  DEFAULT_CALL_SHEET_SECTIONS,
  effectiveSections,
  isSystemSectionKey,
  overrideFromEdit,
  SPECIAL_TRANSPORT_KEY,
  type AutoElementRow,
  type SavedElement,
  type SectionKey,
} from "@/features/call-sheets/lib/sections";

export const NO_RIGHTS = "Недостаточно прав";
export const DAY_NOT_FOUND = "Съёмочный день не найден";
export const SHEET_NOT_CREATED = "Вызывной этого дня ещё не создан";
export const SECTION_NOT_FOUND = "Раздел не найден — обновите страницу";
export const AUTO_ROW_NOT_FOUND = "Строки из сцен дня изменились — обновите страницу";
export const SPECIAL_TRANSPORT_MANUAL =
  "Спецтранспорт правится в блоке «Спецтранспорт», не в элементах площадки";
export const BAD_DATA = "Некорректные данные";

export const MAX_SECTIONS = 40;
export const MAX_SECTION_NAME = 60;
export const MAX_ELEMENT_ROWS = 500;

/** Проверка, что id принадлежат проекту. false — чужой или нет записи. */
export type ElementsInProjectCheck = (
  entity: "ShootDay" | "CallSheetSection",
  ids: string[],
) => Promise<boolean>;

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? BAD_DATA;
}

function parseJson(raw: unknown): { value: unknown } | { error: string } {
  if (typeof raw !== "string") return { value: raw };
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { error: BAD_DATA };
  }
}

const id = z.string().trim().max(100);

// ---- Разделы ----

const sectionRowSchema = z.object({
  /** "" — раздела ещё нет в базе (новый свой или системный из кода). */
  id,
  /** Системный ключ для раздела из кода, у остальных "" (у сохранённых берётся из базы). */
  key: z.string().trim().max(40),
  name: z
    .string()
    .trim()
    .min(1, "Укажите название раздела")
    .max(MAX_SECTION_NAME, `Название раздела — не длиннее ${MAX_SECTION_NAME} символов`),
});

export const sectionsPayloadSchema = z.object({
  sections: z.array(sectionRowSchema).max(MAX_SECTIONS, "Слишком много разделов"),
  /** Свои разделы со строками вызывных, удаление которых подтвердили. */
  confirmedDeletes: z.array(id).max(MAX_SECTIONS * 2).default([]),
});

export type SectionsPayload = z.infer<typeof sectionsPayloadSchema>;

export function parseSectionsPayload(
  raw: unknown,
): { data: SectionsPayload } | { error: string } {
  const json = parseJson(raw);
  if ("error" in json) return json;
  const parsed = sectionsPayloadSchema.safeParse(json.value);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return { data: parsed.data };
}

/** Проверки сохранения разделов до записи: право, данные, разделы — этого проекта. */
export async function checkSectionsSave(
  deps: { canEdit: boolean; inProject: ElementsInProjectCheck },
  raw: unknown,
): Promise<{ data: SectionsPayload } | { error: string }> {
  if (!deps.canEdit) return { error: NO_RIGHTS };
  const parsed = parseSectionsPayload(raw);
  if ("error" in parsed) return parsed;
  const ids = parsed.data.sections.map((row) => row.id).filter((v) => v !== "");
  if (!(await deps.inProject("CallSheetSection", ids))) return { error: SECTION_NOT_FOUND };
  return parsed;
}

/** Раздел проекта в базе с числом строк вызывных в нём. */
export type ExistingSection = {
  id: string;
  key: string | null;
  name: string;
  sortOrder: number;
  elementCount: number;
};

export type SectionsPlan = {
  creates: { key: string | null; name: string; sortOrder: number }[];
  updates: { id: string; name: string; sortOrder: number }[];
  deletes: { id: string; name: string; elementCount: number }[];
  changed: boolean;
  /** Для журнала: разделы до и после, удалённые с числом строк. */
  audit: {
    from: string[];
    to: string[];
    deleted?: { name: string; rows: number }[];
  };
};

export function systemSectionNotDeletable(name: string) {
  return `Раздел «${name}» системный — его можно переименовать и передвинуть, но не удалить`;
}

export function sectionHasRows(name: string, rows: number) {
  return `В разделе «${name}» есть строки вызывных (${rows}) — подтвердите удаление`;
}

/**
 * План сохранения разделов: что создать, переименовать/передвинуть, удалить.
 * Системный раздел удалить нельзя; свой раздел со строками — только с подтверждением.
 */
export function planSectionsSave(
  existing: ExistingSection[],
  data: SectionsPayload,
): SectionsPlan | { error: string } {
  const byId = new Map(existing.map((row) => [row.id, row]));
  const byKey = new Map(
    existing.filter((row) => row.key !== null).map((row) => [row.key!, row]),
  );
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();

  const creates: SectionsPlan["creates"] = [];
  const updates: SectionsPlan["updates"] = [];

  for (const [index, row] of data.sections.entries()) {
    const nameKey = row.name.toLowerCase();
    if (seenNames.has(nameKey)) return { error: `Два раздела с названием «${row.name}»` };
    seenNames.add(nameKey);

    let target: ExistingSection | undefined;
    let key: string | null = null;
    if (row.id !== "") {
      target = byId.get(row.id);
      if (!target) return { error: SECTION_NOT_FOUND };
      key = target.key;
    } else if (row.key !== "") {
      if (!isSystemSectionKey(row.key)) return { error: SECTION_NOT_FOUND };
      key = row.key;
      target = byKey.get(row.key);
    }
    if (target) {
      if (seenIds.has(target.id)) return { error: BAD_DATA };
      seenIds.add(target.id);
    }
    if (key !== null) {
      if (seenKeys.has(key)) return { error: BAD_DATA };
      seenKeys.add(key);
    }

    if (target) {
      if (target.name !== row.name || target.sortOrder !== index) {
        updates.push({ id: target.id, name: row.name, sortOrder: index });
      }
    } else {
      creates.push({ key, name: row.name, sortOrder: index });
    }
  }

  for (const s of DEFAULT_CALL_SHEET_SECTIONS) {
    if (!seenKeys.has(s.key)) {
      return { error: systemSectionNotDeletable(byKey.get(s.key)?.name ?? s.name) };
    }
  }

  const confirmed = new Set(data.confirmedDeletes);
  const deletes: SectionsPlan["deletes"] = [];
  for (const row of existing) {
    if (seenIds.has(row.id)) continue;
    if (row.key !== null) return { error: systemSectionNotDeletable(row.name) };
    if (row.elementCount > 0 && !confirmed.has(row.id)) {
      return { error: sectionHasRows(row.name, row.elementCount) };
    }
    deletes.push({ id: row.id, name: row.name, elementCount: row.elementCount });
  }

  const from = effectiveSections(existing).map((row) => row.name);
  const to = data.sections.map((row) => row.name);
  return {
    creates,
    updates,
    deletes,
    // Системные разделы из кода, которых ещё нет в базе, с тем же названием и местом —
    // не изменение: на экране они уже так и показаны.
    changed:
      updates.length > 0 ||
      deletes.length > 0 ||
      creates.some((c) => c.key === null) ||
      JSON.stringify(from) !== JSON.stringify(to),
    audit: {
      from,
      to,
      ...(deletes.length > 0
        ? { deleted: deletes.map((d) => ({ name: d.name, rows: d.elementCount })) }
        : {}),
    },
  };
}

// ---- Элементы площадки ----

/** Время «ЧЧ:ММ» (00:00–23:59). Пусто — без времени. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeField = z
  .string()
  .trim()
  .refine((v) => v === "" || TIME_PATTERN.test(v), "Время — в виде ЧЧ:ММ");

export const MAX_ELEMENT_NAME = 200;
export const MAX_ELEMENT_QUANTITY = 40;
export const MAX_ELEMENT_SCENES = 300;
export const MAX_ELEMENT_NOTES = 500;

const valueFields = {
  name: z.string().trim().max(MAX_ELEMENT_NAME, `«Что» — не длиннее ${MAX_ELEMENT_NAME} символов`),
  quantity: z
    .string()
    .trim()
    .max(MAX_ELEMENT_QUANTITY, `Количество — не длиннее ${MAX_ELEMENT_QUANTITY} символов`),
  scenes: z
    .string()
    .trim()
    .max(MAX_ELEMENT_SCENES, `Сцены — не длиннее ${MAX_ELEMENT_SCENES} символов`),
  arrivalTime: timeField,
  readyTime: timeField,
  wrapTime: timeField,
  notes: z
    .string()
    .trim()
    .max(MAX_ELEMENT_NOTES, `Примечание — не длиннее ${MAX_ELEMENT_NOTES} символов`),
  secondUnit: z.boolean(),
};

const autoEditSchema = z.object({
  autoKey: z.string().trim().min(1).max(300),
  hidden: z.boolean(),
  ...valueFields,
});

const manualSchema = z.object({
  /** id раздела или «key:КЛЮЧ» для системного раздела, которого ещё нет в базе. */
  section: z.string().trim().min(1, "Не выбран раздел").max(100),
  ...valueFields,
  name: valueFields.name.min(1, "Укажите, что нужно на площадке"),
});

export const elementsPayloadSchema = z.object({
  /** Все авто-строки дня с экрана — с правками и «убрать из вызывного». */
  autoEdits: z.array(autoEditSchema).max(MAX_ELEMENT_ROWS, "Слишком много строк"),
  /** Правки строк, которых нет в сценах дня, — оставить как есть (не перечисленные удаляются). */
  keepOrphans: z.array(z.string().trim().max(300)).max(MAX_ELEMENT_ROWS).default([]),
  /** Ручные строки по порядку. */
  manual: z.array(manualSchema).max(MAX_ELEMENT_ROWS, "Слишком много строк"),
});

export type ElementsPayload = z.infer<typeof elementsPayloadSchema>;

export function parseElementsPayload(
  raw: unknown,
): { data: ElementsPayload } | { error: string } {
  const json = parseJson(raw);
  if ("error" in json) return json;
  const parsed = elementsPayloadSchema.safeParse(json.value);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return { data: parsed.data };
}

const KEY_REF = "key:";

/** Ссылка на раздел с экрана: id из базы или системный ключ раздела, которого ещё нет в базе. */
export function sectionRef(section: { id: string | null; key: string | null }): string {
  return section.id ?? `${KEY_REF}${section.key}`;
}

function parseSectionRef(ref: string): { id: string } | { key: string } {
  return ref.startsWith(KEY_REF) ? { key: ref.slice(KEY_REF.length) } : { id: ref };
}

/**
 * Проверки сохранения элементов до записи: право, день этого проекта, данные,
 * разделы ручных строк — этого проекта (системный — по ключу, кроме спецтранспорта).
 */
export async function checkElementsSave(
  deps: { canEdit: boolean; inProject: ElementsInProjectCheck },
  dayId: unknown,
  raw: unknown,
): Promise<{ dayId: string; data: ElementsPayload } | { error: string }> {
  if (!deps.canEdit) return { error: NO_RIGHTS };
  if (typeof dayId !== "string" || dayId.trim() === "" || dayId.length > 100) {
    return { error: DAY_NOT_FOUND };
  }
  const parsed = parseElementsPayload(raw);
  if ("error" in parsed) return parsed;
  if (!(await deps.inProject("ShootDay", [dayId]))) return { error: DAY_NOT_FOUND };

  const sectionIds: string[] = [];
  for (const row of parsed.data.manual) {
    const ref = parseSectionRef(row.section);
    if ("key" in ref) {
      if (!isSystemSectionKey(ref.key)) return { error: SECTION_NOT_FOUND };
      if (ref.key === SPECIAL_TRANSPORT_KEY) return { error: SPECIAL_TRANSPORT_MANUAL };
    } else {
      sectionIds.push(ref.id);
    }
  }
  if (!(await deps.inProject("CallSheetSection", [...new Set(sectionIds)]))) {
    return { error: SECTION_NOT_FOUND };
  }
  return { dayId, data: parsed.data };
}

/** Строка к записи: раздел — id из базы или системный ключ (id появится после ensure). */
export type ElementWrite = Omit<SavedElement, "sectionId"> & {
  section: { id: string } | { key: SectionKey };
};

/**
 * Что записать в элементы вызывного: правки авто-строк (только непустые), сохранённые правки
 * строк, которых нет в сценах (если их оставили), и ручные строки.
 * autoKey — только из текущих авто-строк дня или уже сохранённых правок.
 */
export function planElementsSave(input: {
  autoRows: AutoElementRow[];
  saved: SavedElement[];
  sections: { id: string; key: string | null }[];
  data: ElementsPayload;
}): { rows: ElementWrite[] } | { error: string } {
  const autoByKey = new Map(input.autoRows.map((row) => [row.autoKey, row]));
  const savedByKey = new Map(
    input.saved.filter((row) => row.autoKey !== null).map((row) => [row.autoKey!, row]),
  );
  const sectionById = new Map(input.sections.map((row) => [row.id, row]));
  const handled = new Set<string>();
  const rows: ElementWrite[] = [];

  const keepSaved = (saved: SavedElement) => {
    const { sectionId, ...rest } = saved;
    rows.push({ ...rest, sortOrder: 0, section: { id: sectionId } });
  };

  for (const edit of input.data.autoEdits) {
    if (handled.has(edit.autoKey)) return { error: BAD_DATA };
    handled.add(edit.autoKey);
    const auto = autoByKey.get(edit.autoKey);
    if (auto) {
      const override = overrideFromEdit(auto, edit);
      if (override) {
        rows.push({
          ...override,
          autoKey: auto.autoKey,
          sortOrder: 0,
          section: { key: auto.sectionKey },
        });
      }
      continue;
    }
    // Строки уже нет в сценах (поменяли КПП, пока была открыта страница) — правку не теряем.
    const saved = savedByKey.get(edit.autoKey);
    if (!saved) return { error: AUTO_ROW_NOT_FOUND };
    keepSaved(saved);
  }

  for (const key of input.data.keepOrphans) {
    if (handled.has(key)) continue;
    handled.add(key);
    const saved = savedByKey.get(key);
    // Нет такой правки (удалили в другом окне) — оставлять нечего.
    if (saved) keepSaved(saved);
  }

  for (const [index, row] of input.data.manual.entries()) {
    const ref = parseSectionRef(row.section);
    let section: ElementWrite["section"];
    if ("key" in ref) {
      if (!isSystemSectionKey(ref.key)) return { error: SECTION_NOT_FOUND };
      if (ref.key === SPECIAL_TRANSPORT_KEY) return { error: SPECIAL_TRANSPORT_MANUAL };
      section = { key: ref.key };
    } else {
      const found = sectionById.get(ref.id);
      if (!found) return { error: SECTION_NOT_FOUND };
      if (found.key === SPECIAL_TRANSPORT_KEY) return { error: SPECIAL_TRANSPORT_MANUAL };
      section = { id: found.id };
    }
    const orNull = (v: string) => (v === "" ? null : v);
    rows.push({
      section,
      autoKey: null,
      hidden: false,
      name: row.name,
      quantity: orNull(row.quantity),
      scenes: orNull(row.scenes),
      arrivalTime: orNull(row.arrivalTime),
      readyTime: orNull(row.readyTime),
      wrapTime: orNull(row.wrapTime),
      notes: orNull(row.notes),
      secondUnit: row.secondUnit,
      sortOrder: index,
    });
  }
  return { rows };
}

/** Разделы строк — в id базы. Раздела нет (удалили в другом окне) — ошибка. */
export function resolveSectionIds(
  rows: ElementWrite[],
  sections: { id: string; key: string | null }[],
): { rows: SavedElement[] } | { error: string } {
  const ids = new Set(sections.map((row) => row.id));
  const idByKey = new Map(
    sections.filter((row) => row.key !== null).map((row) => [row.key!, row.id]),
  );
  const result: SavedElement[] = [];
  for (const { section, ...rest } of rows) {
    const sectionId = "id" in section ? section.id : idByKey.get(section.key);
    if (!sectionId || !ids.has(sectionId)) return { error: SECTION_NOT_FOUND };
    result.push({ ...rest, sectionId });
  }
  return { rows: result };
}

function comparable(row: SavedElement) {
  return JSON.stringify([
    row.sectionId,
    row.autoKey,
    row.hidden,
    row.name,
    row.quantity,
    row.scenes,
    row.arrivalTime,
    row.readyTime,
    row.wrapTime,
    row.notes,
    row.secondUnit,
    row.autoKey === null ? row.sortOrder : 0,
  ]);
}

/** Сохранённое совпадает с тем, что пришло, — писать нечего. */
export function sameElementRows(a: SavedElement[], b: SavedElement[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(comparable).sort();
  const right = b.map(comparable).sort();
  return left.every((value, index) => value === right[index]);
}

/** Для журнала — счётчики: ручных строк, правок авто-строк, убранных авто-строк. */
export function elementCounts(rows: { autoKey: string | null; hidden: boolean }[]) {
  return {
    manual: rows.filter((row) => row.autoKey === null).length,
    edits: rows.filter((row) => row.autoKey !== null && !row.hidden).length,
    hidden: rows.filter((row) => row.autoKey !== null && row.hidden).length,
  };
}
