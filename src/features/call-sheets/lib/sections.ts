import type { ElementType, SceneResourceCategory } from "@prisma/client";

/** Системные разделы элементов площадки: ключ и название по умолчанию. Порядок — порядок по умолчанию. */
export const DEFAULT_CALL_SHEET_SECTIONS = [
  { key: "GROUP", name: "Групповка" },
  { key: "GAME_TRANSPORT", name: "Игровой транспорт" },
  { key: "PROPS", name: "Реквизит" },
  { key: "COSTUME", name: "Костюм" },
  { key: "STUNTS", name: "Трюки" },
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

/** Ресурс сцены из либретто → раздел. Грим и «своё» — в «Прочее». */
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
    case "CAMERA":
      return "CAMERA";
    default:
      return OTHER_SECTION_KEY;
  }
}

/** Элемент разбора сцены → раздел. Пиро/SFX, грим, прочее — в «Прочее». */
export function sectionForElement(type: ElementType): SectionKey {
  switch (type) {
    case "PROP":
      return "PROPS";
    case "VEHICLE":
      return "GAME_TRANSPORT";
    case "WARDROBE":
    case "COSTUME":
      return "COSTUME";
    default:
      return OTHER_SECTION_KEY;
  }
}

/**
 * Названия категорий каталога, которым раздел ставится по умолчанию. Только точное совпадение
 * (без регистра, «ё» = «е», лишние пробелы не важны), не по части слова: «Пиротехника» не
 * попадёт в «Опер. технику». Тот же список — в миграции данных
 * 20261101121045_resource_category_call_sheet_section (тест сверяет).
 */
export const CATEGORY_DEFAULT_NAMES: Record<
  Exclude<SectionKey, "SPECIAL_TRANSPORT" | "OTHER">,
  readonly string[]
> = {
  GROUP: ["групповка", "массовка", "групповка и массовка", "массовка и групповка"],
  GAME_TRANSPORT: ["игровой транспорт", "игровые машины"],
  PROPS: ["реквизит", "игровой реквизит"],
  COSTUME: ["костюм", "костюмы"],
  STUNTS: ["трюки", "трюк", "каскадеры"],
  CAMERA: ["опер. техника", "операторская техника", "опер техника"],
  CG: ["cg", "графика", "компьютерная графика"],
};

export function normalizeCategoryName(name: string): string {
  return name.toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

/**
 * Раздел по умолчанию для новой категории — по точному названию. Посменные категории —
 * без раздела (в элементы площадки они не попадают). null — без раздела («Прочее»).
 * Вызывается только при создании категории; дальше раздел меняют руками.
 */
export function defaultSectionKeyForCategory(category: {
  name: string;
  perShift: boolean;
}): SectionKey | null {
  if (category.perShift) return null;
  const name = normalizeCategoryName(category.name);
  for (const [key, names] of Object.entries(CATEGORY_DEFAULT_NAMES)) {
    if (names.includes(name)) return key as SectionKey;
  }
  return null;
}

/** Раздел строки: системный по ключу или раздел проекта по id. */
export type AutoRowSection = { key: SectionKey } | { id: string };

/**
 * Позиция каталога → раздел по настройке её категории. Посменные — не в элементах (null).
 * Раздел не выбран (или выбран спецтранспорт, который правится в своём блоке) — «Прочее».
 */
export function sectionForResourceCategory(category: {
  perShift: boolean;
  callSheetSection: { id: string; key: string | null } | null;
}): AutoRowSection | null {
  if (category.perShift) return null;
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
      category: {
        perShift: boolean;
        callSheetSection: { id: string; key: string | null } | null;
      };
    };
  }[];
};

/** Авто-строка раздела: что, сколько, в каких сценах. */
export type AutoElementRow = {
  autoKey: string;
  section: AutoRowSection;
  name: string;
  /** Наибольшее количество по сценам; null — количества нет (элемент разбора). */
  quantity: string | null;
  /** Номера сцен через запятую. */
  scenes: string;
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
};

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
  map.set(autoKey, { section, name, quantity, scenes: new Set([sceneNumber]) });
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
 * Порядок: системные разделы по порядку по умолчанию, потом разделы проекта, внутри — по названию.
 */
export function buildAutoRows(scenes: AutoSourceScene[]): AutoElementRow[] {
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
      if (!section || !name) continue;
      add(map, itemAutoKey(link.itemId), section, name, link.quantity, num);
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
    arrivalTime: override?.arrivalTime ?? "",
    readyTime: override?.readyTime ?? "",
    wrapTime: override?.wrapTime ?? "",
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
  const row = {
    hidden: edit.hidden,
    name: edit.name === "" || edit.name === auto.name ? "" : edit.name,
    quantity: edit.quantity === (auto.quantity ?? "") ? null : edit.quantity,
    scenes: edit.scenes === auto.scenes ? null : edit.scenes,
    arrivalTime: orNull(edit.arrivalTime),
    readyTime: orNull(edit.readyTime),
    wrapTime: orNull(edit.wrapTime),
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
 * Разделы для экрана: из базы по порядку, недостающие системные — из кода (id null) в конце.
 * Пока у проекта разделов в базе нет, это ровно разделы по умолчанию.
 */
export function effectiveSections(
  dbRows: SectionRecord[],
): { id: string | null; key: string | null; name: string }[] {
  const keys = new Set(dbRows.map((row) => row.key));
  return [
    ...dbRows.map((row) => ({ id: row.id, key: row.key, name: row.name })),
    ...DEFAULT_CALL_SHEET_SECTIONS.filter((s) => !keys.has(s.key)).map((s) => ({
      id: null,
      key: s.key,
      name: s.name,
    })),
  ];
}

/** Что нужно базе для создания недостающих системных разделов. */
export type SectionsStore = {
  listKeys: () => Promise<{ key: string | null; sortOrder: number }[]>;
  /** Создать строки, пропуская уже существующие по [projectId, key]. Вернуть число созданных. */
  createManySkipDuplicates: (
    rows: { projectId: string; key: string; name: string; sortOrder: number }[],
  ) => Promise<number>;
};

/**
 * Создаёт недостающие системные разделы проекта. Повторный и одновременный вызов безопасны:
 * уникальный ключ [projectId, key] и пропуск дублей.
 */
export async function ensureSectionsIn(store: SectionsStore, projectId: string): Promise<number> {
  const existing = await store.listKeys();
  const keys = new Set(existing.map((row) => row.key));
  const missing = DEFAULT_CALL_SHEET_SECTIONS.filter((s) => !keys.has(s.key));
  if (missing.length === 0) return 0;
  const base =
    existing.length === 0 ? 0 : Math.max(...existing.map((row) => row.sortOrder)) + 1;
  return store.createManySkipDuplicates(
    missing.map((s, index) => ({
      projectId,
      key: s.key,
      name: s.name,
      sortOrder: base + index,
    })),
  );
}
