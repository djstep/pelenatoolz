import { STANDARD_PHYSICAL_PARAM_KEYS } from "@/features/preproduction/lib/snapshots";

/** Поля «Другое» в форме: это ввод нового параметра, а не сам параметр. */
const FORM_ONLY_KEYS = ["custom_key", "custom_value"];

function savedParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && !FORM_ONLY_KEYS.includes(entry[0]),
    ),
  );
}

/** Свои параметры кандидата: форма показывает их отдельными полями, иначе они пропадут. */
export function customPhysicalParamKeys(value: unknown): string[] {
  const standard: readonly string[] = STANDARD_PHYSICAL_PARAM_KEYS;
  return Object.keys(savedParams(value)).filter((key) => !standard.includes(key));
}

/**
 * Параметры из формы. Пустое поле убирает параметр; параметр, которого в форме нет,
 * остаётся как был (saved): как и другие поля, он не считается стёртым.
 */
export function parsePhysicalParams(formData: FormData, saved?: unknown) {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(savedParams(saved))) {
    if (!formData.has(`phys_${key}`)) params[key] = value;
  }
  for (const key of formData.keys()) {
    if (!key.startsWith("phys_")) continue;
    const paramKey = key.slice(5);
    if (FORM_ONLY_KEYS.includes(paramKey)) continue;
    const val = String(formData.get(key) ?? "").trim();
    if (val) params[paramKey] = val;
  }
  const customKey = String(formData.get("phys_custom_key") ?? "").trim();
  const customVal = String(formData.get("phys_custom_value") ?? "").trim();
  if (customKey && customVal) params[customKey] = customVal;
  return params;
}
