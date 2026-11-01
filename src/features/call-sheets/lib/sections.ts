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
] as const;

export type SectionKey = (typeof DEFAULT_CALL_SHEET_SECTIONS)[number]["key"];

/** Спецтранспорт правится в своём блоке — в разделе только показ, своих строк нет. */
export const SPECIAL_TRANSPORT_KEY: SectionKey = "SPECIAL_TRANSPORT";

const SECTION_KEYS = new Set<string>(DEFAULT_CALL_SHEET_SECTIONS.map((s) => s.key));

export function isSystemSectionKey(key: string | null | undefined): key is SectionKey {
  return typeof key === "string" && SECTION_KEYS.has(key);
}

export function defaultSectionName(key: string | null): string | null {
  return DEFAULT_CALL_SHEET_SECTIONS.find((s) => s.key === key)?.name ?? null;
}

// ---- Соответствие типов разделам ----

/** Ресурс сцены из либретто → раздел. Грим и «своё» — без раздела. */
export function sectionForSceneResource(category: SceneResourceCategory): SectionKey | null {
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
      return null;
  }
}

/** Элемент разбора сцены → раздел. Пиро/SFX, грим, прочее — без раздела. */
export function sectionForElement(type: ElementType): SectionKey | null {
  switch (type) {
    case "PROP":
      return "PROPS";
    case "VEHICLE":
      return "GAME_TRANSPORT";
    case "WARDROBE":
    case "COSTUME":
      return "COSTUME";
    default:
      return null;
  }
}

const CATEGORY_KEYWORDS: { words: string[]; key: SectionKey }[] = [
  { words: ["групп", "массов"], key: "GROUP" },
  { words: ["транспорт"], key: "GAME_TRANSPORT" },
  { words: ["реквиз"], key: "PROPS" },
  { words: ["костюм"], key: "COSTUME" },
  { words: ["трюк", "каскад"], key: "STUNTS" },
  { words: ["техник", "оператор", "камер"], key: "CAMERA" },
  { words: ["cg", "график"], key: "CG" },
];

/**
 * Категория каталога ресурсов → раздел по ключевым словам в названии.
 * Посменные категории — без раздела (это люди и техника «на смену», не по сценам).
 * «Спецтранспорт» — без раздела: он правится в блоке «Спецтранспорт».
 */
export function sectionForResourceCategory(category: {
  name: string;
  perShift: boolean;
}): SectionKey | null {
  if (category.perShift) return null;
  const name = category.name.toLowerCase();
  if (name.includes("спецтранс")) return null;
  for (const rule of CATEGORY_KEYWORDS) {
    if (rule.words.some((word) => name.includes(word))) return rule.key;
  }
  return null;
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
    item: { name: string; category: { name: string; perShift: boolean } };
  }[];
};

/** Авто-строка раздела: что, сколько, в каких сценах. */
export type AutoElementRow = {
  autoKey: string;
  sectionKey: SectionKey;
  name: string;
  /** Сумма количеств по сценам; null — количества нет (элемент разбора). */
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
  sectionKey: SectionKey;
  name: string;
  quantity: number | null;
  scenes: Set<string>;
};

function add(
  map: Map<string, Accumulator>,
  autoKey: string,
  sectionKey: SectionKey,
  name: string,
  quantity: number | null,
  sceneNumber: string,
) {
  const existing = map.get(autoKey);
  if (existing) {
    if (quantity !== null) existing.quantity = (existing.quantity ?? 0) + quantity;
    existing.scenes.add(sceneNumber);
    return;
  }
  map.set(autoKey, { sectionKey, name, quantity, scenes: new Set([sceneNumber]) });
}

const SECTION_ORDER = new Map<string, number>(
  DEFAULT_CALL_SHEET_SECTIONS.map((s, index) => [s.key, index]),
);

/**
 * Авто-строки элементов площадки из сцен дня. Вырезанные сцены строк не дают.
 * Одинаковое из разных сцен — одна строка: количество — сумма, сцены — список номеров.
 * Порядок: по разделам, внутри — по названию.
 */
export function buildAutoRows(scenes: AutoSourceScene[]): AutoElementRow[] {
  const map = new Map<string, Accumulator>();
  for (const scene of scenes) {
    if (scene.cutAt) continue;
    const num = formatSceneNumber(scene);
    for (const res of scene.resources) {
      const sectionKey = sectionForSceneResource(res.category);
      const name = res.name.trim();
      if (!sectionKey || !name) continue;
      add(map, resourceAutoKey(sectionKey, name), sectionKey, name, res.quantity, num);
    }
    for (const link of scene.elements) {
      const sectionKey = sectionForElement(link.element.type);
      const name = link.element.name.trim();
      if (!sectionKey || !name) continue;
      add(map, elementAutoKey(link.element.id), sectionKey, name, null, num);
    }
    for (const link of scene.resourceItems) {
      const sectionKey = sectionForResourceCategory(link.item.category);
      const name = link.item.name.trim();
      if (!sectionKey || !name) continue;
      add(map, itemAutoKey(link.itemId), sectionKey, name, link.quantity, num);
    }
  }
  return [...map.entries()]
    .map(([autoKey, entry]) => ({
      autoKey,
      sectionKey: entry.sectionKey,
      name: entry.name,
      quantity: entry.quantity !== null && entry.quantity > 0 ? String(entry.quantity) : null,
      scenes: [...entry.scenes]
        .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))
        .join(", "),
    }))
    .sort(
      (a, b) =>
        (SECTION_ORDER.get(a.sectionKey) ?? 0) - (SECTION_ORDER.get(b.sectionKey) ?? 0) ||
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
