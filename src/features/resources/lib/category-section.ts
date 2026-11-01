import {
  defaultSectionKeyForCategory,
  isSystemSectionKey,
  OTHER_SECTION_KEY,
  SPECIAL_TRANSPORT_KEY,
  type SectionKey,
} from "@/features/call-sheets/lib/sections";

/**
 * «Раздел вызывного» у категории ресурсов: в какой раздел элементов площадки попадают её
 * позиции. Значение в форме: "" — без раздела («Прочее»), «key:КЛЮЧ» — системный раздел
 * (его может ещё не быть в базе), иначе id раздела проекта. При создании ещё «auto» —
 * по точному названию категории; дальше раздел меняют только руками.
 */

export const AUTO_SECTION = "auto";
const KEY_REF = "key:";

export const NO_RIGHTS = "Недостаточно прав";
export const SECTION_NOT_FOUND = "Раздел вызывного не найден";
export const SPECIAL_TRANSPORT_SECTION =
  "Спецтранспорт правится в своём блоке вызывного — выберите другой раздел";

export type CategorySection = { kind: "none" } | { kind: "key"; key: SectionKey } | { kind: "id"; id: string };

export type CategorySectionDeps = {
  canEdit: boolean;
  /** Ключ раздела этого проекта (null — свой раздел); undefined — раздела нет или он чужой. */
  sectionKey: (id: string) => Promise<string | null | undefined>;
};

/**
 * Проверка выбора до записи: право (как у правки категорий), раздел этого проекта, не
 * спецтранспорт. `creating` — новая категория: «auto» и пустое поле дают раздел по названию.
 */
export async function checkCategorySection(
  deps: CategorySectionDeps,
  raw: unknown,
  category: { name: string; perShift: boolean; creating: boolean },
): Promise<{ section: CategorySection } | { error: string }> {
  if (!deps.canEdit) return { error: NO_RIGHTS };
  const value = typeof raw === "string" ? raw.trim() : raw == null ? null : undefined;
  if (value === undefined || (value !== null && value.length > 100)) {
    return { error: SECTION_NOT_FOUND };
  }

  if (value === null || value === AUTO_SECTION) {
    if (!category.creating) return { error: SECTION_NOT_FOUND };
    const key = defaultSectionKeyForCategory(category);
    return { section: key ? { kind: "key", key } : { kind: "none" } };
  }
  if (value === "") return { section: { kind: "none" } };

  if (value.startsWith(KEY_REF)) {
    const key = value.slice(KEY_REF.length);
    if (!isSystemSectionKey(key)) return { error: SECTION_NOT_FOUND };
    if (key === SPECIAL_TRANSPORT_KEY) return { error: SPECIAL_TRANSPORT_SECTION };
    // «Прочее» и «без раздела» — одно и то же.
    if (key === OTHER_SECTION_KEY) return { section: { kind: "none" } };
    return { section: { kind: "key", key } };
  }

  const key = await deps.sectionKey(value);
  if (key === undefined) return { error: SECTION_NOT_FOUND };
  if (key === SPECIAL_TRANSPORT_KEY) return { error: SPECIAL_TRANSPORT_SECTION };
  if (key === OTHER_SECTION_KEY) return { section: { kind: "none" } };
  return { section: { kind: "id", id: value } };
}
