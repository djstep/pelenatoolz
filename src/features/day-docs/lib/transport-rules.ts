import { z } from "zod";

/**
 * Спецтранспорт дня: проверки сохранения — чистые функции (без базы), действие
 * `saveCallSheetTransportsAction` вызывает именно их. Сохранение — по id строки:
 * есть id — обновить, нет — создать, пропавшие — удалить. Строки не пересоздаются,
 * поэтому строки отчёта смены (`transport:<id>`) с км и начислениями остаются те же.
 */

/** Время «ЧЧ:ММ» (00:00–23:59). Пусто — без времени. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Пусто или не прислано — null. */
const optionalTime = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || TIME_PATTERN.test(v), `${label} — в виде ЧЧ:ММ`)
    .nullish()
    .transform((v) => (v ? v : null));

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((v) => (v ? v : null));

export const MAX_TRANSPORT_ROWS = 100;
export const MAX_KM_RATE = 1_000_000_000;

const transportRowSchema = z.object({
  /** id сохранённой строки; пусто — новая строка */
  id: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : null)),
  name: z
    .string()
    .trim()
    .min(1, "Укажите название спецтранспорта")
    .max(200, "Название спецтранспорта — до 200 символов"),
  callTime: optionalTime("Подача"),
  wrapTime: optionalTime("Конец"),
  scenes: optionalText(200, "Сцены спецтранспорта — до 200 символов"),
  notes: optionalText(500, "Примечание спецтранспорта — до 500 символов"),
  /** Не прислано — оставить как сохранено (у новой строки — без ставки). */
  kmRate: z
    .number("Ставка за км — число")
    .min(0, "Ставка за км не может быть меньше 0")
    .max(MAX_KM_RATE, "Слишком большая ставка за км")
    .nullable()
    .optional(),
  /** Не прислано — оставить как сохранено (у новой строки — без статьи). Пусто — без статьи. */
  budgetItemId: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null)),
});

export const transportSaveSchema = z
  .object({
    rows: z.array(transportRowSchema).max(MAX_TRANSPORT_ROWS, "Слишком много строк"),
  })
  .superRefine((data, ctx) => {
    const ids = data.rows.map((row) => row.id).filter((id): id is string => id !== null);
    if (new Set(ids).size < ids.length) {
      ctx.addIssue({ code: "custom", message: "Строка спецтранспорта повторяется" });
    }
  });

export type TransportSaveData = z.infer<typeof transportSaveSchema>;
export type TransportRowInput = TransportSaveData["rows"][number];

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Проверьте спецтранспорт";
}

/** Разбор JSON строк из формы (`{ rows: [...] }`). */
export function parseTransportPayload(
  raw: unknown,
): { data: TransportSaveData } | { error: string } {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { error: "Некорректные данные" };
    }
  }
  const parsed = transportSaveSchema.safeParse(value);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  return { data: parsed.data };
}

export const NO_RIGHTS = "Недостаточно прав";
export const DAY_NOT_FOUND = "Съёмочный день не найден";
/** id строки не из этого дня (или строку уже удалили). */
export const TRANSPORT_NOT_FOUND = "Объект не найден";
export const FINANCE_BUDGET_ITEM =
  "Статью сметы у спецтранспорта ставит и меняет только тот, у кого есть право «Финансы: правка». Ничего не сохранено — верните статью как было.";
export const FINANCE_KM_RATE =
  "Ставку за км у спецтранспорта меняет только тот, у кого есть право «Финансы: правка». Ничего не сохранено — верните ставку как было.";

/** Строка спецтранспорта, как она лежит в базе (ставка — числом). */
export type StoredTransport = {
  id: string;
  name: string;
  callTime: string | null;
  wrapTime: string | null;
  scenes: string | null;
  notes: string | null;
  kmRate: number | null;
  budgetItemId: string | null;
  sortOrder: number;
};

export type TransportFields = Omit<StoredTransport, "id">;

export type TransportSavePlan = {
  /** Новые строки (порядок — как в списке) */
  create: TransportFields[];
  /** Сохранённые строки, у которых что-то поменялось (в том числе порядок) */
  update: { id: string; data: TransportFields }[];
  /** id строк этого дня, которых больше нет в списке */
  remove: string[];
  /** Статьи, которые на своей строке поставлены или сменены (их проверяет смета) */
  changedBudgetItemIds: string[];
  /** Поменялись ли статья / ставка км хоть у одной строки (новая строка — против «пусто») */
  financeChanged: { budgetItem: boolean; kmRate: boolean };
};

function sameMoney(a: number | null, b: number | null) {
  if (a === null || b === null) return a === null && b === null;
  return Math.round(a * 100) === Math.round(b * 100);
}

function sameFields(a: TransportFields, b: TransportFields) {
  return (
    a.name === b.name &&
    a.callTime === b.callTime &&
    a.wrapTime === b.wrapTime &&
    a.scenes === b.scenes &&
    a.notes === b.notes &&
    sameMoney(a.kmRate, b.kmRate) &&
    a.budgetItemId === b.budgetItemId &&
    a.sortOrder === b.sortOrder
  );
}

/**
 * План сохранения по id. `existing` — строки ЭТОГО дня. id, которого среди них нет
 * (строка другого дня, другого проекта или уже удалённая), — отказ `TRANSPORT_NOT_FOUND`.
 * sortOrder — место в списке (с нуля подряд). Ставка и статья, которых нет в присланном,
 * остаются как сохранены.
 */
export function planTransportSave(
  existing: readonly StoredTransport[],
  rows: readonly TransportRowInput[],
): { plan: TransportSavePlan } | { error: string } {
  const byId = new Map(existing.map((row) => [row.id, row]));
  const plan: TransportSavePlan = {
    create: [],
    update: [],
    remove: [],
    changedBudgetItemIds: [],
    financeChanged: { budgetItem: false, kmRate: false },
  };
  const kept = new Set<string>();

  for (const [index, row] of rows.entries()) {
    const stored = row.id ? byId.get(row.id) : undefined;
    if (row.id && !stored) return { error: TRANSPORT_NOT_FOUND };

    const storedKm = stored?.kmRate ?? null;
    const storedItem = stored?.budgetItemId ?? null;
    const fields: TransportFields = {
      name: row.name,
      callTime: row.callTime,
      wrapTime: row.wrapTime,
      scenes: row.scenes,
      notes: row.notes,
      kmRate: row.kmRate === undefined ? storedKm : row.kmRate,
      budgetItemId: row.budgetItemId === undefined ? storedItem : row.budgetItemId,
      sortOrder: index,
    };

    if (!sameMoney(fields.kmRate, storedKm)) plan.financeChanged.kmRate = true;
    if (fields.budgetItemId !== storedItem) {
      plan.financeChanged.budgetItem = true;
      if (fields.budgetItemId) plan.changedBudgetItemIds.push(fields.budgetItemId);
    }

    if (stored) {
      kept.add(stored.id);
      const { id, ...before } = stored;
      if (!sameFields(before, fields)) plan.update.push({ id, data: fields });
    } else {
      plan.create.push(fields);
    }
  }

  plan.remove = existing.filter((row) => !kept.has(row.id)).map((row) => row.id);
  plan.changedBudgetItemIds = [...new Set(plan.changedBudgetItemIds)];
  return { plan };
}

/** Проверка, что id принадлежат проекту. false — чужой или нет записи. */
export type DayInProjectCheck = (entity: "ShootDay", ids: string[]) => Promise<boolean>;

export type TransportSaveDeps = {
  /** «КПП и вызывные: правка» (`canEditCallSheets`) */
  canEdit: boolean;
  /** «Финансы: правка» — ставить/менять статью и ставку км */
  canEditFinance: boolean;
  inProject: DayInProjectCheck;
  /** Строки спецтранспорта дня (день уже проверен на проект) */
  loadDayTransports: (dayId: string) => Promise<StoredTransport[]>;
  /** Статьи из видимых смет и не в архиве (`checkBudgetItemsUsable`); текст ошибки или null */
  budgetItemsUsable: (ids: string[]) => Promise<string | null>;
};

/**
 * Все проверки сохранения спецтранспорта до записи, по порядку: право правки вызывного
 * (до базы), день этого проекта, данные, id строк — этого дня, фин. право на смену статьи
 * и ставки км, статьи — из видимых смет. Любой отказ — ничего не пишется.
 */
export async function checkTransportSave(
  deps: TransportSaveDeps,
  dayId: unknown,
  raw: unknown,
): Promise<
  | { dayId: string; existing: StoredTransport[]; data: TransportSaveData; plan: TransportSavePlan }
  | { error: string }
> {
  if (!deps.canEdit) return { error: NO_RIGHTS };
  if (typeof dayId !== "string" || dayId.trim() === "" || dayId.length > 100) {
    return { error: DAY_NOT_FOUND };
  }
  if (!(await deps.inProject("ShootDay", [dayId]))) return { error: DAY_NOT_FOUND };

  const parsed = parseTransportPayload(raw);
  if ("error" in parsed) return parsed;

  const existing = await deps.loadDayTransports(dayId);
  const planned = planTransportSave(existing, parsed.data.rows);
  if ("error" in planned) return planned;
  const { plan } = planned;

  if (!deps.canEditFinance) {
    if (plan.financeChanged.budgetItem) return { error: FINANCE_BUDGET_ITEM };
    if (plan.financeChanged.kmRate) return { error: FINANCE_KM_RATE };
  }

  const itemError = await deps.budgetItemsUsable(plan.changedBudgetItemIds);
  if (itemError) return { error: itemError };

  return { dayId, existing, data: parsed.data, plan };
}

/**
 * Ставить и менять статью сметы и ставку км у спецтранспорта — «Финансы: правка», то же
 * право, что и статья у начисления. У спецтранспорта нет карточки (актёр, объект, категория
 * ресурса), поэтому и в отчёте смены его ставки — по разделу «Финансы» (`finance:read`).
 */
export function canEditTransportFinance(access: {
  can: (permission: "finance:write") => boolean;
}): boolean {
  return access.can("finance:write");
}

/** Видеть ставку км спецтранспорта: «Финансы» — просмотр фин. условий или правка. */
export function canSeeTransportKmRate(access: {
  can: (permission: "finance:read" | "finance:write") => boolean;
}): boolean {
  return access.can("finance:read") || access.can("finance:write");
}

/** Строка для редактора (поля — строками, как в полях ввода). */
export type TransportEditorRow = {
  id: string;
  name: string;
  callTime: string;
  wrapTime: string;
  scenes: string;
  notes: string;
  /** "" — без ставки или ставку не видно (нет фин. права) */
  kmRate: string;
  /** "" — без статьи */
  budgetItemId: string;
};

export function toEditorRow(row: StoredTransport, showKmRate: boolean): TransportEditorRow {
  return {
    id: row.id,
    name: row.name,
    callTime: row.callTime ?? "",
    wrapTime: row.wrapTime ?? "",
    scenes: row.scenes ?? "",
    notes: row.notes ?? "",
    kmRate: showKmRate && row.kmRate !== null ? String(row.kmRate) : "",
    budgetItemId: row.budgetItemId ?? "",
  };
}

/** "" — без ставки; не число — как есть (сервер ответит «Ставка за км — число»). */
function kmRateValue(raw: string): number | null | string {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : text;
}

/**
 * Строки редактора → данные для сохранения. Без фин. права ставка и статья не присылаются
 * (сервер оставит сохранённые).
 */
export function editorRowsPayload(
  rows: readonly TransportEditorRow[],
  canEditFinance: boolean,
): string {
  return JSON.stringify({
    rows: rows.map((row) => ({
      ...(row.id ? { id: row.id } : {}),
      name: row.name,
      callTime: row.callTime,
      wrapTime: row.wrapTime,
      scenes: row.scenes,
      notes: row.notes,
      ...(canEditFinance
        ? {
            kmRate: kmRateValue(row.kmRate),
            budgetItemId: row.budgetItemId || null,
          }
        : {}),
    })),
  });
}

/** Для журнала: что добавлено, удалено, изменено; смена статьи и ставки — «было → стало». */
export function transportAuditChanges(existing: readonly StoredTransport[], plan: TransportSavePlan) {
  const byId = new Map(existing.map((row) => [row.id, row]));
  const finance: { name: string; field: "budgetItemId" | "kmRate"; from: unknown; to: unknown }[] =
    [];
  for (const { id, data } of plan.update) {
    const before = byId.get(id);
    if (!before) continue;
    if (before.budgetItemId !== data.budgetItemId) {
      finance.push({
        name: data.name,
        field: "budgetItemId",
        from: before.budgetItemId,
        to: data.budgetItemId,
      });
    }
    if (!sameMoney(before.kmRate, data.kmRate)) {
      finance.push({ name: data.name, field: "kmRate", from: before.kmRate, to: data.kmRate });
    }
  }
  return {
    added: plan.create.map((row) => ({
      name: row.name,
      budgetItemId: row.budgetItemId,
      kmRate: row.kmRate,
    })),
    removed: plan.remove.map((id) => byId.get(id)?.name ?? id),
    updated: plan.update.map(({ data }) => data.name),
    ...(finance.length ? { finance } : {}),
  };
}
