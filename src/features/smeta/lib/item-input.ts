/**
 * Проверка данных строки сметы, пришедших из браузера. Числа — строками (без потерь точности),
 * запятая допускается, пусто — null. Ничего, кроме описанных полей, не принимается.
 */

export type LineMultiplierInput = { variableId: string } | { value: string } | null;

export type LineInput = {
  name: string;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  multipliers: [LineMultiplierInput, LineMultiplierInput, LineMultiplierInput];
  expenseTypeId: string | null;
  paymentFormId: string | null;
  /** undefined — налог % не прислан: при смене формы оплаты берётся её процент. */
  taxPercent: string | null | undefined;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_NAME = 300;
const MAX_UNIT = 40;

/** Id из браузера — строка разумной длины. */
export function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

/**
 * Неотрицательное десятичное число: строка или число, запятая или точка, не больше `scale`
 * знаков после запятой и не больше `max`. Пусто — null.
 */
export function parseDecimal(
  raw: unknown,
  scale: number,
  max: number,
): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  let text: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false };
    text = String(raw);
  } else if (typeof raw === "string") {
    text = raw.trim().replace(/\s/g, "").replace(",", ".");
  } else {
    return { ok: false };
  }
  if (text === "") return { ok: true, value: null };
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(text);
  if (!match) return { ok: false };
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > scale) return { ok: false };
  const value = fraction ? `${BigInt(match[1]!)}.${fraction}` : `${BigInt(match[1]!)}`;
  if (Number(value) > max) return { ok: false };
  return { ok: true, value };
}

function optionalText(raw: unknown, max: number): Parsed<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "Некорректный текст" };
  const text = raw.trim();
  if (text.length > max) return { ok: false, error: `Не длиннее ${max} символов` };
  return { ok: true, value: text === "" ? null : text };
}

function optionalId(raw: unknown): Parsed<string | null> {
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };
  return isId(raw) ? { ok: true, value: raw } : { ok: false, error: "Некорректная ссылка" };
}

/** Название строки или подстатьи: обязательно, без лишних пробелов. */
export function parseName(raw: unknown, max = MAX_NAME): Parsed<string> {
  if (typeof raw !== "string") return { ok: false, error: "Введите наименование" };
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Введите наименование" };
  if (name.length > max) return { ok: false, error: `Наименование не длиннее ${max} символов` };
  return { ok: true, value: name };
}

function parseMultiplier(raw: unknown, index: number): Parsed<LineMultiplierInput> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `Множитель ${index + 1}: некорректно` };
  const m = raw as Record<string, unknown>;
  const keys = Object.keys(m);
  if (keys.length === 1 && keys[0] === "variableId") {
    return isId(m.variableId)
      ? { ok: true, value: { variableId: m.variableId } }
      : { ok: false, error: `Множитель ${index + 1}: некорректная переменная` };
  }
  if (keys.length === 1 && keys[0] === "value") {
    const parsed = parseDecimal(m.value, 4, 1_000_000_000);
    if (!parsed.ok) return { ok: false, error: `Множитель ${index + 1}: число от 0, до 4 знаков после запятой` };
    return { ok: true, value: parsed.value === null ? null : { value: parsed.value } };
  }
  return { ok: false, error: `Множитель ${index + 1}: переменная или число` };
}

/** Данные строки целиком (добавление и правка строки шлют все поля). */
export function parseLineInput(raw: unknown): Parsed<LineInput> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Некорректные данные строки" };
  }
  const r = raw as Record<string, unknown>;

  const name = parseName(r.name);
  if (!name.ok) return name;
  const unit = optionalText(r.unit, MAX_UNIT);
  if (!unit.ok) return { ok: false, error: `Единица: ${unit.error.toLowerCase()}` };

  const quantity = parseDecimal(r.quantity, 4, 1_000_000_000_000);
  if (!quantity.ok) return { ok: false, error: "Количество — число от 0, до 4 знаков после запятой" };
  const rate = parseDecimal(r.rate, 2, 1_000_000_000_000);
  if (!rate.ok) return { ok: false, error: "Ставка — число от 0, до 2 знаков после запятой" };

  const rawMultipliers = r.multipliers ?? [];
  if (!Array.isArray(rawMultipliers) || rawMultipliers.length > 3) {
    return { ok: false, error: "Не больше трёх множителей" };
  }
  const multipliers: LineMultiplierInput[] = [];
  for (let i = 0; i < 3; i++) {
    const m = parseMultiplier(rawMultipliers[i], i);
    if (!m.ok) return m;
    multipliers.push(m.value);
  }

  const expenseTypeId = optionalId(r.expenseTypeId);
  if (!expenseTypeId.ok) return { ok: false, error: "Тип расхода: некорректная ссылка" };
  const paymentFormId = optionalId(r.paymentFormId);
  if (!paymentFormId.ok) return { ok: false, error: "Форма оплаты: некорректная ссылка" };

  let taxPercent: string | null | undefined;
  if (r.taxPercent !== undefined) {
    const parsed = parseDecimal(r.taxPercent, 4, 100);
    if (!parsed.ok) return { ok: false, error: "Налог — от 0 до 100 %" };
    taxPercent = parsed.value;
  }

  return {
    ok: true,
    value: {
      name: name.value,
      unit: unit.value,
      quantity: quantity.value,
      rate: rate.value,
      multipliers: multipliers as LineInput["multipliers"],
      expenseTypeId: expenseTypeId.value,
      paymentFormId: paymentFormId.value,
      taxPercent,
    },
  };
}

/** Внутренний код строки: ПРЕФИКС-СС.ПП.НН (статья шаблона, подстатья, строка). На экран не выводится. */
export function lineCode(prefix: string, articleNumber: number, subarticleNumber: number, lineNumber: number) {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${two(articleNumber)}.${two(subarticleNumber)}.${two(lineNumber)}`;
}
