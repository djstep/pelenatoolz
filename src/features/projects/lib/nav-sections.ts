/**
 * Раскрытые разделы меню из `localStorage`: `{ "id раздела": true/false }`. Значение могло
 * испортиться или остаться от старой версии: всё, что не подходит, считается «не задано».
 */
export function parseNavSections(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(([, open]) => typeof open === "boolean"),
  );
}
