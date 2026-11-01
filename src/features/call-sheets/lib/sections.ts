import type { ElementType, SceneResourceCategory } from "@prisma/client";

/** Системные разделы элементов площадки: ключ и название по умолчанию. Порядок — порядок по умолчанию. */
export const DEFAULT_CALL_SHEET_SECTIONS = [
  { key: "GROUP", name: "Групповка" },
  { key: "GAME_TRANSPORT", name: "Игровой транспорт" },
  { key: "PROPS", name: "Реквизит" },
  { key: "COSTUME", name: "Костюм" },
  { key: "MAKEUP", name: "Грим" },
  { key: "STUNTS", name: "Трюки" },
  { key: "SFX", name: "Спецэффекты" },
  { key: "CAMERA", name: "Опер. техника" },
  { key: "CG", name: "CG" },
  { key: "SPECIAL_TRANSPORT", name: "Спецтранспорт" },
  { key: "OTHER", name: "Прочее" },
] as const;

export type SectionKey = (typeof DEFAULT_CALL_SHEET_SECTIONS)[number]["key"];

/** Спецтранспорт правится в своём блоке — в разделе только показ, своих строк нет. */
export const SPECIAL_TRANSPORT_KEY: SectionKey = "SPECIAL_TRANSPORT";

/** Всё, чему раздел не назначен, — в «Прочее». */
export const OTHER_SECTION_KEY: SectionKey = "OTHER";

const SECTION_KEYS = new Set<string>(DEFAULT_CALL_SHEET_SECTIONS.map((s) => s.key));

export function isSystemSectionKey(key: string | null | undefined): key is SectionKey {
  return typeof key === "string" && SECTION_KEYS.has(key);
}

export function defaultSectionName(key: string | null): string | null {
  return DEFAULT_CALL_SHEET_SECTIONS.find((s) => s.key === key)?.name ?? null;
}

// ---- Соответствие типов разделам ----

/** Ресурс сцены из либретто → раздел. «Своё» — в «Прочее». */
export function sectionForSceneResource(category: SceneResourceCategory): SectionKey {
  switch (category) {
    case "EXTRAS":
    case "GROUP":
      return "GROUP";
    case "STUNT":
      return "STUNTS";
    case "PROP":
      return "PROPS";
    case "VEHICLE":
      return "GAME_TRANSPORT";
    case "COSTUME":
      return "COSTUME";
    case "MAKEUP":
      return "MAKEUP";
    case "CAMERA":
      return "CAMERA";
    default:
      return OTHER_SECTION_KEY;
  }
}

/** Элемент разбора сцены → раздел. SFX — «Спецэффекты», грим — «Грим», прочее — «Прочее». */
export function sectionForElement(type: ElementType): SectionKey {
  switch (type) {
    case "PROP":
      return "PROPS";
    case "VEHICLE":
      return "GAME_TRANSPORT";
    case "WARDROBE":
    case "COSTUME":
      return "COSTUME";
    case "MAKEUP":
      return "MAKEUP";
    case "SFX":
      return "SFX";
    default:
      return OTHER_SECTION_KEY;
  }
}

/**
 * Названия категорий каталога, которым раздел ставится по умолчанию. Только точное совпадение
 * (без регистра, «ё» = «е», лишние пробелы не важны), не по части слова: «Пиротехника» не
 * попадёт в «Опер. технику». Миграция данных 20261101121045_resource_category_call_sheet_section
 * разметила существующие категории по этому списку без «Грима» и «Спецэффектов» (их тогда не
 * было); каждая её пара есть здесь — тест сверяет.
 */
export const CATEGORY_DEFAULT_NAMES: Record<
  Exclude<SectionKey, "SPECIAL_TRANSPORT" | "OTHER">,
  readonly string[]
> = {
  GROUP: ["групповка", "массовка", "групповка и массовка", "массовка и групповка"],
  GAME_TRANSPORT: ["игровой транспорт", "игровые машины"],
  PROPS: ["реквизит", "игровой реквизит"],
  COSTUME: ["костюм", "костюмы"],
  MAKEUP: ["грим"],
  STUNTS: ["трюки", "трюк", "каскадеры"],
  SFX: ["спецэффекты", "спецэффект", "спец. эффекты", "sfx"],
  CAMERA: ["опер. техника", "операторская техника", "опер техника"],
  CG: ["cg", "графика", "компьютерная графика"],
};

export function normalizeCategoryName(name: string): string {
  return name.toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

/**
 * Раздел по умолчанию для новой категории — по точному названию (посменной тоже).
 * null — без раздела («Прочее»). Вызывается только при создании категории; дальше раздел
 * меняют руками.
 */
export function defaultSectionKeyForCategory(category: { name: string }): SectionKey | null {
  const name = normalizeCategoryName(category.name);
  for (const [key, names] of Object.entries(CATEGORY_DEFAULT_NAMES)) {
    if (names.includes(name)) return key as SectionKey;
  }
  return null;
}

/** Раздел строки: системный по ключу или раздел проекта по id. */
export type AutoRowSection = { key: SectionKey } | { id: string };

/**
 * Позиция каталога (из сцен или посменная) → раздел по настройке её категории.
 * Раздел не выбран (или выбран спецтранспорт, который правится в своём блоке) — «Прочее».
 */
export function sectionForResourceCategory(category: {
  callSheetSection: { id: string; key: string | null } | null;
}): AutoRowSection {
  const section = category.callSheetSection;
  if (!section || section.key === SPECIAL_TRANSPORT_KEY) return { key: OTHER_SECTION_KEY };
  return { id: section.id };
}

// ---- Авто-строки из сцен дня ----

/** Сцена дня с разбором — то, из чего собираются авто-строки. */
export type AutoSourceScene = {
  cutAt: Date | null;
  episodeNumber: number;
  number: string;
  postfix: string;
  resources: { category: SceneResourceCategory; name: string; quantity: number }[];
  elements: { element: { id: string; type: ElementType; name: string } }[];
  resourceItems: {
    itemId: string;
    quantity: number;
    item: {
      name: string;
      category: { callSheetSection: { id: string; key: string | null } | null };
    };
  }[];
};

/** Посменный ресурс, добавленный в день (ShootDayResourceUsage), с его временем. */
export type AutoSourceShiftResource = {
  itemId: string;
  arrivalTime: string | null;
  readyTime: string | null;
  wrapTime: string | null;
  item: {
    name: string;
    category: { callSheetSection: { id: string; key: string | null } | null };
  };
};

/** Авто-строка раздела: что, сколько, в каких сценах. */
export type AutoElementRow = {
  autoKey: string;
  section: AutoRowSection;
  name: string;
  /** Наибольшее количество по сценам; null — количества нет (элемент разбора). */
  quantity: string | null;
  /** Номера сцен через запятую ("" — посменный ресурс, не из сцен). */
  scenes: string;
  /** Время из дня: у посменного ресурса — подача, готов, конец; иначе null. */
  arrivalTime: string | null;
  readyTime: string | null;
  wrapTime: string | null;
};

/** Номер сцены как в документах дня: «серия-номер+постфикс». */
export function formatSceneNumber(scene: {
  episodeNumber: number;
  number: string;
  postfix: string;
}): string {
  const ep = scene.episodeNumber > 0 ? `${scene.episodeNumber}-` : "";
  return `${ep}${scene.number}${scene.postfix || ""}`;
}

const MAX_KEY_NAME = 200;

/** Ключ строки ресурса либретто: по разделу и названию (без регистра). */
export function resourceAutoKey(sectionKey: SectionKey, name: string): string {
  return `res:${sectionKey}:${name.trim().toLowerCase().slice(0, MAX_KEY_NAME)}`;
}

export function elementAutoKey(elementId: string): string {
  return `el:${elementId}`;
}

export function itemAutoKey(itemId: string): string {
  return `item:${itemId}`;
}

/** Из ключа — что это: ресурс либретто (с названием), элемент или позиция каталога. */
export function parseAutoKey(
  autoKey: string,
):
  | { kind: "res"; sectionKey: string; name: string }
  | { kind: "el"; id: string }
  | { kind: "item"; id: string }
  | null {
  if (autoKey.startsWith("res:")) {
    const rest = autoKey.slice(4);
    const colon = rest.indexOf(":");
    if (colon < 0) return null;
    return { kind: "res", sectionKey: rest.slice(0, colon), name: rest.slice(colon + 1) };
  }
  if (autoKey.startsWith("el:")) return { kind: "el", id: autoKey.slice(3) };
  if (autoKey.startsWith("item:")) return { kind: "item", id: autoKey.slice(5) };
  return null;
}

type Accumulator = {
  section: AutoRowSection;
  name: string;
  quantity: number | null;
  scenes: Set<string>;
  times: { arrivalTime: string | null; readyTime: string | null; wrapTime: string | null };
};

const NO_TIMES = { arrivalTime: null, readyTime: null, wrapTime: null };

function add(
  map: Map<string, Accumulator>,
  autoKey: string,
  section: AutoRowSection,
  name: string,
  quantity: number | null,
  sceneNumber: string,
) {
  const existing = map.get(autoKey);
  if (existing) {
    // Одни и те же люди и вещи в разных сценах — не сумма, а наибольшее количество.
    if (quantity !== null) existing.quantity = Math.max(existing.quantity ?? 0, quantity);
    existing.scenes.add(sceneNumber);
    return;
  }
  map.set(autoKey, { section, name, quantity, scenes: new Set([sceneNumber]), times: NO_TIMES });
}

const SECTION_ORDER = new Map<string, number>(
  DEFAULT_CALL_SHEET_SECTIONS.map((s, index) => [s.key, index]),
);

function sectionOrder(section: AutoRowSection): number {
  return "key" in section ? (SECTION_ORDER.get(section.key) ?? 0) : SECTION_ORDER.size;
}

/**
 * Авто-строки элементов площадки из сцен дня. Вырезанные сцены строк не дают.
 * Одинаковое из разных сцен — одна строка: количество — наибольшее, сцены — список номеров.
 * Посменные ресурсы дня — тоже строки (в разделе своей категории), с их временем подачи.
 * Порядок: системные разделы по порядку по умолчанию, потом разделы проекта, внутри — по названию.
 */
export function buildAutoRows(
  scenes: AutoSourceScene[],
  shiftResources: AutoSourceShiftResource[] = [],
): AutoElementRow[] {
  const map = new Map<string, Accumulator>();
  for (const scene of scenes) {
    if (scene.cutAt) continue;
    const num = formatSceneNumber(scene);
    for (const res of scene.resources) {
      const sectionKey = sectionForSceneResource(res.category);
      const name = res.name.trim();
      if (!name) continue;
      add(map, resourceAutoKey(sectionKey, name), { key: sectionKey }, name, res.quantity, num);
    }
    for (const link of scene.elements) {
      const sectionKey = sectionForElement(link.element.type);
      const name = link.element.name.trim();
      if (!name) continue;
      add(map, elementAutoKey(link.element.id), { key: sectionKey }, name, null, num);
    }
    for (const link of scene.resourceItems) {
      const section = sectionForResourceCategory(link.item.category);
      const name = link.item.name.trim();
      if (!name) continue;
      add(map, itemAutoKey(link.itemId), section, name, link.quantity, num);
    }
  }
  for (const usage of shiftResources) {
    const name = usage.item.name.trim();
    if (!name) continue;
    const times = {
      arrivalTime: usage.arrivalTime || null,
      readyTime: usage.readyTime || null,
      wrapTime: usage.wrapTime || null,
    };
    const key = itemAutoKey(usage.itemId);
    const existing = map.get(key);
    if (existing) existing.times = times;
    else {
      map.set(key, {
        section: sectionForResourceCategory(usage.item.category),
        name,
        quantity: null,
        scenes: new Set(),
        times,
      });
    }
  }
  return [...map.entries()]
    .map(([autoKey, entry]) => ({
      autoKey,
      section: entry.section,
      name: entry.name,
      quantity: entry.quantity !== null && entry.quantity > 0 ? String(entry.quantity) : null,
      scenes: [...entry.scenes]
        .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))
        .join(", "),
      ...entry.times,
    }))
    .sort(
      (a, b) =>
        sectionOrder(a.section) - sectionOrder(b.section) ||
        a.name.localeCompare(b.name, "ru"),
    );
}

// ---- Правки авто-строк ----

/** Строка элементов вызывного, как она лежит в базе. */
export type SavedElement = {
  sectionId: string;
  autoKey: string | null;
  hidden: boolean;
  /** У правки авто-строки "" — название из сцен. */
  name: string;
  /** У правки авто-строки null — значение из сцен. */
  quantity: string | null;
  scenes: string | null;
  arrivalTime: string | null;
  readyTime: string | null;
  wrapTime: string | null;
  notes: string | null;
  secondUnit: boolean;
  sortOrder: number;
};

/** Значения строки для экрана: пустое поле — пустая строка. */
export type ElementValues = {
  name: string;
  quantity: string;
  scenes: string;
  arrivalTime: string;
  readyTime: string;
  wrapTime: string;
  notes: string;
  secondUnit: boolean;
};

export type MergedAutoRow = {
  auto: AutoElementRow;
  hidden: boolean;
  value: ElementValues;
};

/** Значения авто-строки с наложенной правкой. */
export function applyOverride(
  auto: AutoElementRow,
  override: SavedElement | null | undefined,
): ElementValues {
  return {
    name: override?.name || auto.name,
    quantity: override?.quantity ?? auto.quantity ?? "",
    scenes: override?.scenes ?? auto.scenes,
    arrivalTime: override?.arrivalTime ?? auto.arrivalTime ?? "",
    readyTime: override?.readyTime ?? auto.readyTime ?? "",
    wrapTime: override?.wrapTime ?? auto.wrapTime ?? "",
    notes: override?.notes ?? "",
    secondUnit: override?.secondUnit ?? false,
  };
}

/**
 * Авто-строки с правками этого вызывного. Правки строк, которых больше нет в сценах дня, —
 * отдельно (orphans), чтобы не потерять их молча.
 */
export function mergeAutoRows(
  autoRows: AutoElementRow[],
  saved: SavedElement[],
): { rows: MergedAutoRow[]; orphans: SavedElement[] } {
  const overrides = new Map(
    saved.filter((row) => row.autoKey !== null).map((row) => [row.autoKey!, row]),
  );
  const autoKeys = new Set(autoRows.map((row) => row.autoKey));
  return {
    rows: autoRows.map((auto) => {
      const override = overrides.get(auto.autoKey);
      return { auto, hidden: override?.hidden ?? false, value: applyOverride(auto, override) };
    }),
    orphans: [...overrides.values()].filter((row) => !autoKeys.has(row.autoKey!)),
  };
}

/** Правка авто-строки из значений с экрана. null — правки нет, строка как в сценах. */
export function overrideFromEdit(
  auto: AutoElementRow,
  edit: ElementValues & { hidden: boolean },
): Omit<SavedElement, "sectionId" | "autoKey" | "sortOrder"> | null {
  const orNull = (v: string) => (v === "" ? null : v);
  // Время как в дне — не правка (null); стёрли время, которое было в дне, — "".
  const time = (v: string, fromDay: string | null) => (v === (fromDay ?? "") ? null : v);
  const row = {
    hidden: edit.hidden,
    name: edit.name === "" || edit.name === auto.name ? "" : edit.name,
    quantity: edit.quantity === (auto.quantity ?? "") ? null : edit.quantity,
    scenes: edit.scenes === auto.scenes ? null : edit.scenes,
    arrivalTime: time(edit.arrivalTime, auto.arrivalTime),
    readyTime: time(edit.readyTime, auto.readyTime),
    wrapTime: time(edit.wrapTime, auto.wrapTime),
    notes: orNull(edit.notes),
    secondUnit: edit.secondUnit,
  };
  const empty =
    !row.hidden &&
    row.name === "" &&
    row.quantity === null &&
    row.scenes === null &&
    row.arrivalTime === null &&
    row.readyTime === null &&
    row.wrapTime === null &&
    row.notes === null &&
    !row.secondUnit;
  return empty ? null : row;
}

// ---- Разделы проекта ----

export type SectionRecord = { id: string; key: string | null; name: string };

/**
 * Куда встают недостающие системные разделы: сразу после ближайшего предыдущего раздела из
 * списка по умолчанию, который у проекта есть (так «Грим» встаёт после «Костюма», даже если
 * разделы переставляли); «Прочее» — всегда в конец. `rows` — разделы проекта по порядку.
 */
export function placeMissingSections<T extends { key: string | null }>(
  rows: T[],
): ({ row: T } | { missing: (typeof DEFAULT_CALL_SHEET_SECTIONS)[number] })[] {
  const list: ({ row: T } | { missing: (typeof DEFAULT_CALL_SHEET_SECTIONS)[number] })[] =
    rows.map((row) => ({ row }));
  const keyAt = (index: number) => {
    const item = list[index]!;
    return "row" in item ? item.row.key : item.missing.key;
  };
  const present = new Set(rows.map((row) => row.key));
  for (const [order, section] of DEFAULT_CALL_SHEET_SECTIONS.entries()) {
    if (present.has(section.key)) continue;
    let at = 0;
    if (section.key === OTHER_SECTION_KEY) at = list.length;
    else {
      for (let prev = order - 1; prev >= 0; prev--) {
        const prevKey = DEFAULT_CALL_SHEET_SECTIONS[prev]!.key;
        const index = list.findIndex((_item, i) => keyAt(i) === prevKey);
        if (index >= 0) {
          at = index + 1;
          break;
        }
      }
    }
    list.splice(at, 0, { missing: section });
    present.add(section.key);
  }
  return list;
}

/**
 * Разделы для экрана: из базы по порядку, недостающие системные — из кода (id null) на своих
 * местах. Пока у проекта разделов в базе нет, это ровно разделы по умолчанию.
 */
export function effectiveSections(
  dbRows: SectionRecord[],
): { id: string | null; key: string | null; name: string }[] {
  return placeMissingSections(dbRows).map((item) =>
    "row" in item
      ? { id: item.row.id, key: item.row.key, name: item.row.name }
      : { id: null, key: item.missing.key, name: item.missing.name },
  );
}

/** Что нужно базе для создания недостающих системных разделов. */
export type SectionsStore = {
  /** Разделы проекта по порядку. */
  list: () => Promise<{ id: string; key: string | null; sortOrder: number }[]>;
  /** Создать строки, пропуская уже существующие по [projectId, key]. Вернуть число созданных. */
  createManySkipDuplicates: (
    rows: { projectId: string; key: string; name: string; sortOrder: number }[],
  ) => Promise<number>;
  /** Новый порядок разделов, которые сдвинулись из-за вставки. */
  setSortOrders: (rows: { id: string; sortOrder: number }[]) => Promise<void>;
};

/**
 * Создаёт недостающие системные разделы проекта на своих местах (см. placeMissingSections),
 * сдвигая порядок остальных. Повторный и одновременный вызов безопасны: уникальный ключ
 * [projectId, key] и пропуск дублей.
 */
export async function ensureSectionsIn(store: SectionsStore, projectId: string): Promise<number> {
  const existing = [...(await store.list())].sort((a, b) => a.sortOrder - b.sortOrder);
  const placed = placeMissingSections(existing);
  const missing = placed.flatMap((item, index) =>
    "missing" in item ? [{ projectId, key: item.missing.key, name: item.missing.name, sortOrder: index }] : [],
  );
  if (missing.length === 0) return 0;
  const moved = placed.flatMap((item, index) =>
    "row" in item && item.row.sortOrder !== index ? [{ id: item.row.id, sortOrder: index }] : [],
  );
  if (moved.length > 0) await store.setSortOrders(moved);
  return store.createManySkipDuplicates(missing);
}
