/**
 * Процент из поля формы: «6», «6,5», «  13 ». Пусто — нет значения (не 0).
 * Ошибка — не число или вне 0–100.
 */
export function parseOptionalPercent(
  raw: FormDataEntryValue | null | undefined,
): { ok: true; value: number | null } | { ok: false } {
  const text = typeof raw === "string" ? raw.trim().replace(",", ".") : "";
  if (text === "") return { ok: true, value: null };
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return { ok: false };
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 100) return { ok: false };
  return { ok: true, value };
}

/** То же, но пусто — ошибка. */
export function parseRequiredPercent(
  raw: FormDataEntryValue | null | undefined,
): { ok: true; value: number } | { ok: false } {
  const parsed = parseOptionalPercent(raw);
  return parsed.ok && parsed.value !== null ? { ok: true, value: parsed.value } : { ok: false };
}

/** Значение переменной из поля формы: пусто — не задано (null), иначе число ≥ 0. */
export function parseOptionalVariableValue(
  raw: FormDataEntryValue | null | undefined,
): { ok: true; value: number | null } | { ok: false } {
  const text = typeof raw === "string" ? raw.trim().replace(",", ".") : "";
  if (text === "") return { ok: true, value: null };
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return { ok: false };
  const value = Number(text);
  if (!Number.isFinite(value) || value > 1_000_000_000) return { ok: false };
  return { ok: true, value };
}

/** «6 %», «6,5 %» или «—» для пустого. */
export function formatPercent(value: number | null): string {
  return value == null ? "—" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 4 })} %`;
}
