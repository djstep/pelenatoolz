/**
 * Импорт из Excel в смету цеха по статьям: какие колонки листа куда идут, какие строки листа —
 * строки сметы, разбор множителей. Только расчёт, без базы: сервер потом проверяет каждую
 * строку и пишет всё одной транзакцией (или ничего, если хоть одна строка с ошибкой).
 */

export const IMPORT_FIELDS = [
  { id: "code", label: "Код" },
  { id: "name", label: "Наименование" },
  { id: "expenseType", label: "Тип" },
  { id: "unit", label: "Ед." },
  { id: "quantity", label: "Кол-во" },
  { id: "rate", label: "Ставка" },
  { id: "multipliers", label: "Множители" },
  { id: "paymentForm", label: "Форма оплаты" },
  { id: "taxPercent", label: "Налог, %" },
] as const;

export type ImportFieldId = (typeof IMPORT_FIELDS)[number]["id"];
export const IMPORT_FIELD_IDS = IMPORT_FIELDS.map((f) => f.id) as readonly ImportFieldId[];

/** Номер колонки листа (с 0) для каждого поля; нет — поле не загружается. */
export type ImportMapping = Partial<Record<ImportFieldId, number>>;

/** Строка листа, разложенная по полям; `row` — номер строки в Excel (с 1). */
export type ImportRow = { row: number; values: Partial<Record<ImportFieldId, string>> };

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_COLUMNS = 40;

/** Заголовки, по которым колонка узнаётся сама (в нижнем регистре, без точек и пробелов по краям). */
const SYNONYMS: Record<ImportFieldId, string[]> = {
  code: ["код", "code", "шифр"],
  name: ["наименование", "название", "статья", "позиция", "строка", "описание"],
  expenseType: ["тип", "тип расхода", "вид расхода"],
  unit: ["ед", "единица", "ед изм", "единица измерения"],
  quantity: ["кол-во", "количество", "кол во", "qty"],
  rate: ["ставка", "цена", "стоимость", "цена за ед", "rate"],
  multipliers: ["множители", "множитель", "коэффициент", "коэф"],
  paymentForm: ["форма оплаты", "форма", "оплата"],
  taxPercent: ["налог %", "налог, %", "налог%", "% налога", "ставка налога"],
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/\./g, "").replace(/\s+/g, " ").trim();
}

function fieldOfHeader(text: string): ImportFieldId | null {
  const t = normalize(text);
  if (!t) return null;
  for (const id of IMPORT_FIELD_IDS) if (SYNONYMS[id].some((s) => normalize(s) === t)) return id;
  return null;
}

/** Строка заголовков: первая (из первых 20), где узнаются хотя бы две колонки; иначе первая непустая. */
export function guessHeaderRow(rows: readonly string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (rows[i].filter((c) => fieldOfHeader(c)).length >= 2) return i;
  }
  const first = rows.findIndex((r) => r.some((c) => c.trim() !== ""));
  return first < 0 ? 0 : first;
}

/** Колонки по заголовкам: каждая — к своему полю, первая подходящая. */
export function guessMapping(header: readonly string[]): ImportMapping {
  const mapping: ImportMapping = {};
  header.forEach((text, index) => {
    const field = fieldOfHeader(text);
    if (field && mapping[field] === undefined) mapping[field] = index;
  });
  return mapping;
}

/** «TR-05» и «TR-05.01» — коды статьи и подстатьи из нашей выгрузки: это не строки сметы. */
const GROUP_CODE = /^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9]{1,5}-\d{2,}(\.\d{2,})?$/u;

/**
 * Строки сметы из листа: после строки заголовков, только непустые. Строки статей и подстатей
 * нашей выгрузки (код статьи/подстатьи) и строки «Итого…» пропускаются.
 */
export function mappedRows(rows: readonly string[][], headerRow: number, mapping: ImportMapping): ImportRow[] {
  return splitRows(rows, headerRow, mapping).rows;
}

/**
 * То же, что `mappedRows`, и номера пропущенных строк (статьи, подстатьи, «Итого») — их
 * предпросмотр показывает, чтобы ничего не терялось молча.
 */
export function splitRows(
  rows: readonly string[][],
  headerRow: number,
  mapping: ImportMapping,
): { rows: ImportRow[]; skipped: number[] } {
  const out: ImportRow[] = [];
  const skipped: number[] = [];
  for (let i = headerRow + 1; i < rows.length && out.length < IMPORT_MAX_ROWS; i++) {
    const values: ImportRow["values"] = {};
    for (const id of IMPORT_FIELD_IDS) {
      const col = mapping[id];
      if (col === undefined) continue;
      const v = (rows[i][col] ?? "").trim();
      if (v !== "") values[id] = v;
    }
    if (Object.keys(values).length === 0) continue;
    if ((values.code && GROUP_CODE.test(values.code)) || (!values.code && /^итого/i.test(values.name ?? ""))) {
      skipped.push(i + 1);
      continue;
    }
    out.push({ row: i + 1, values });
  }
  return { rows: out, skipped };
}

export type ParsedMultiplier = { variableId: string } | { value: string } | null;

/**
 * Множители текстом, как в нашей выгрузке: «× СМЕНЫ (10) × 0,7». Переменная узнаётся по названию
 * (значение в скобках не важно — берётся действующее), число — как есть. До трёх множителей.
 */
export function parseMultipliersText(
  text: string,
  variables: readonly { id: string; label: string }[],
): { ok: true; value: ParsedMultiplier[] } | { ok: false; error: string } {
  const parts = text
    .split(/[×*]/u)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 3) return { ok: false, error: "Не больше трёх множителей" };
  const value: ParsedMultiplier[] = [];
  for (const part of parts) {
    const label = part.replace(/\s*\(.*\)\s*$/, "").trim();
    const variable = variables.find((v) => normalize(v.label) === normalize(label));
    if (variable) {
      value.push({ variableId: variable.id });
      continue;
    }
    const number = label.replace(/\s/g, "").replace(",", ".");
    if (/^\d+(\.\d+)?$/.test(number)) {
      value.push({ value: number });
      continue;
    }
    return { ok: false, error: `Множитель «${part}» не найден среди переменных проекта и не число` };
  }
  while (value.length < 3) value.push(null);
  return { ok: true, value };
}

/** Буква колонки Excel по номеру (с 0): A, B, …, AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
