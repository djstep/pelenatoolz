import type { CallSheetPrintModel } from "@/features/call-sheets/print/print-model";

/**
 * Блоки листа вызывного и правило пустых блоков — одно для печати (`buildCallSheetHtml`) и
 * Excel (`buildCallSheetWorkbook`, из него же Google Таблица на диске).
 * Порядок — как в макете владельца (`docs/callsheet-mockup-v5.html`).
 * Обязательные блоки выводятся всегда, пустое поле в них — «не указано» (серым).
 * Необязательные — только если в них что-то есть.
 */

export const NOT_SPECIFIED = "не указано";

export type CallSheetBlockKey =
  | "head"
  | "times"
  | "weather"
  | "locations"
  | "restrictions"
  | "important"
  | "leaders"
  | "crewCalls"
  | "base"
  | "cast"
  | "groups"
  | "elements"
  | "plan"
  | "secondUnit"
  | "scheme";

export const CALL_SHEET_BLOCKS: readonly { key: CallSheetBlockKey; required: boolean }[] = [
  // Шапка: время и место сбора.
  { key: "head", required: true },
  { key: "times", required: true },
  // Строка сведений: погода, объекты, ограничения по актёрам.
  { key: "weather", required: true },
  { key: "locations", required: true },
  { key: "restrictions", required: true },
  { key: "important", required: false },
  { key: "leaders", required: true },
  { key: "crewCalls", required: true },
  { key: "base", required: false },
  { key: "cast", required: true },
  { key: "groups", required: false },
  { key: "elements", required: false },
  { key: "plan", required: true },
  { key: "secondUnit", required: false },
  { key: "scheme", required: false },
];

/** Пуст ли блок: нечего показать, кроме «не указано». */
export function isCallSheetBlockEmpty(model: CallSheetPrintModel, key: CallSheetBlockKey): boolean {
  switch (key) {
    case "head":
      return !model.crewCall.time && !model.crewCall.address;
    case "times":
      return model.times.length === 0;
    case "weather":
      return !model.weather;
    case "locations":
      return model.locations.length === 0;
    case "restrictions":
      return !model.actorRestrictions;
    case "important":
      return !model.important;
    case "leaders":
      return model.leaders.length === 0;
    case "crewCalls":
      return model.crewCalls.length === 0;
    case "base":
      return model.baseItems.length === 0;
    case "cast":
      return model.cast.length === 0;
    case "groups":
      return model.groups.length === 0;
    case "elements":
      return model.elementSections.length === 0;
    case "plan":
      return model.plan.length === 0;
    case "secondUnit":
      return model.secondUnit.rows.length === 0;
    case "scheme":
      return !model.scheme;
  }
}

/** Выводится ли блок: обязательный — всегда, необязательный — если не пуст. */
export function isCallSheetBlockShown(model: CallSheetPrintModel, key: CallSheetBlockKey): boolean {
  const block = CALL_SHEET_BLOCKS.find((b) => b.key === key)!;
  return block.required || !isCallSheetBlockEmpty(model, key);
}

/** Блоки листа по порядку — только те, что выводятся. */
export function shownCallSheetBlocks(model: CallSheetPrintModel): CallSheetBlockKey[] {
  return CALL_SHEET_BLOCKS.filter((b) => isCallSheetBlockShown(model, b.key)).map((b) => b.key);
}

/**
 * ФИ руководителя, как в макете: первое слово (фамилия) — жирным, остальное — обычным.
 * Одно слово — целиком жирным.
 */
export function leaderNameParts(name: string): { last: string; rest: string | null } {
  const [last, ...rest] = name.trim().split(/\s+/);
  return { last: last ?? "", rest: rest.length ? rest.join(" ") : null };
}

/** Полоса времён: все пять, в этом порядке; акцент — мотор и стоп-мотор. */
export const SHIFT_TIMES = [
  { label: "Смена", accent: false },
  { label: "Репетиция", accent: false },
  { label: "Мотор", accent: true },
  { label: "Обед", accent: false },
  { label: "Стоп-мотор", accent: true },
] as const;

/**
 * Полоса времён листа: всегда пять полей, незаполненное — null («не указано»).
 * В модели (и в старых снимках утверждения) — только заполненные, ищем по подписи.
 */
export function shiftTimes(model: CallSheetPrintModel): { label: string; value: string | null; accent: boolean }[] {
  return SHIFT_TIMES.map(({ label, accent }) => ({
    label,
    accent,
    value: model.times.find((time) => time.label === label)?.value ?? null,
  }));
}
