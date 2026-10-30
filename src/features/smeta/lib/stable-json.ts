/**
 * JSON с ключами по алфавиту: база (jsonb) порядок ключей не хранит, а Univer может
 * отдавать их в другом порядке. Одинаковые данные — одинаковая строка. Работает и в
 * браузере (какие листы изменились), и на сервере (совпадает ли с сохранённым).
 */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Предел одного сохранения (лимит тела серверного действия — 4 МБ, с запасом). */
export const SAVE_BODY_LIMIT_BYTES = 3.8 * 1024 * 1024;

/** Лист больше этого в JSON не принимается: первое же его сохранение упрётся в лимит. */
export const SHEET_JSON_LIMIT_BYTES = 2.5 * 1024 * 1024;
