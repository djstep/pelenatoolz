/**
 * Системные переменные: есть в каждом проекте (миграция `smeta_items` и создание проекта).
 * Пустое значение у СМЕНЫ и СЕРИИ берётся из параметров проекта, у остальных — не задано.
 */
export const SYSTEM_FINANCE_VARIABLES: readonly {
  key: "SMENY" | "SERII" | "DNI_PODGOTOVKI" | "NEDELI";
  label: string;
  projectField: "shootingDaysCount" | "episodeCount" | null;
  sortOrder: number;
  description: string;
}[] = [
  {
    key: "SMENY",
    label: "СМЕНЫ",
    projectField: "shootingDaysCount",
    sortOrder: 0,
    description: "Число съёмочных смен (по умолчанию из параметров проекта)",
  },
  {
    key: "SERII",
    label: "СЕРИИ",
    projectField: "episodeCount",
    sortOrder: 1,
    description: "Число серий (по умолчанию из параметров проекта)",
  },
  {
    key: "DNI_PODGOTOVKI",
    label: "ДНИ ПОДГОТОВКИ",
    projectField: null,
    sortOrder: 2,
    description: "Число дней подготовки",
  },
  {
    key: "NEDELI",
    label: "НЕДЕЛИ",
    projectField: null,
    sortOrder: 3,
    description: "Число недель",
  },
];

export type SystemFinanceVariableKey =
  (typeof SYSTEM_FINANCE_VARIABLES)[number]["key"];

export function isSystemFinanceVariableKey(
  key: string,
): key is SystemFinanceVariableKey {
  return SYSTEM_FINANCE_VARIABLES.some((v) => v.key === key);
}

const CYR_TO_LAT: Record<string, string> = {
  А: "A",
  Б: "B",
  В: "V",
  Г: "G",
  Д: "D",
  Е: "E",
  Ё: "E",
  Ж: "ZH",
  З: "Z",
  И: "I",
  Й: "Y",
  К: "K",
  Л: "L",
  М: "M",
  Н: "N",
  О: "O",
  П: "P",
  Р: "R",
  С: "S",
  Т: "T",
  У: "U",
  Ф: "F",
  Х: "H",
  Ц: "TS",
  Ч: "CH",
  Ш: "SH",
  Щ: "SCH",
  Ъ: "",
  Ы: "Y",
  Ь: "",
  Э: "E",
  Ю: "YU",
  Я: "YA",
};

/** slug for custom keys: CUSTOM_MY_VAR */
export function financeVariableKeyFromLabel(label: string): string {
  const upper = label.trim().toUpperCase();
  let translit = "";
  for (const ch of upper) {
    if (CYR_TO_LAT[ch] !== undefined) translit += CYR_TO_LAT[ch];
    else if (/[A-Z0-9]/.test(ch)) translit += ch;
    else if (/\s|_|\-|–|—/.test(ch)) translit += "_";
  }
  const slug = translit
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  const finalSlug = slug || `VAR_${Date.now().toString(36).toUpperCase()}`;
  if (isSystemFinanceVariableKey(finalSlug)) {
    return `CUSTOM_${finalSlug}`;
  }
  return finalSlug.startsWith("CUSTOM_") ? finalSlug : `CUSTOM_${finalSlug}`;
}
