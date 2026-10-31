import type { DayNight, IntExt } from "@prisma/client";
import { cleanSpaces, compareKey, sceneLetter } from "@/features/import/normalize/text";

/**
 * Режимы → значение либретто (решение владельца 1): УТРО → РАССВЕТ,
 * ВЕЧЕР / СУМЕРКИ / РЕЖИМ → ЗАКАТ. Словарь расширяемый.
 */
export const TIME_WORDS: Record<string, DayNight> = {
  УТРО: "DAWN",
  РАССВЕТ: "DAWN",
  ДЕНЬ: "DAY",
  ВЕЧЕР: "DUSK",
  ЗАКАТ: "DUSK",
  СУМЕРКИ: "DUSK",
  РЕЖИМ: "DUSK",
  НОЧЬ: "NIGHT",
  MORNING: "DAWN",
  DAWN: "DAWN",
  DAY: "DAY",
  EVENING: "DUSK",
  DUSK: "DUSK",
  NIGHT: "NIGHT",
};

/** Пометки в шапке. Пометка с режимом («СЛЕДУЮЩЕЕ УТРО») даёт режим без вопроса. */
export const HEADING_NOTES: { text: string; time?: string }[] = [
  { text: "ПОЗЖЕ" },
  { text: "НЕМНОГО ПОЗЖЕ" },
  { text: "СЛЕДУЮЩЕЕ УТРО", time: "УТРО" },
  { text: "ПРОДОЛЖЕНИЕ" },
];

/** Служебные слова вместо объекта: такая шапка — вопрос «сцена или пометка». */
export const SERVICE_OBJECTS = ["ЗАКАДРОВЫЙ ГОЛОС", "ТИТР", "ТИТРЫ"];

/** Сокращения, после которых точка не отделяет подобъект: «КВ. ИВАНА». */
export const PLACE_ABBREVIATIONS = ["КВ", "УЛ", "Д", "ПР", "ПЕР", "Г", "ПОС", "ПЛ"];

export type HeadingLocation = {
  object: string;
  sub: string | null;
  /** Новый объект после « / » — не подобъект первого (вопрос). */
  separate: boolean;
};

export type ParsedHeading = {
  number: string | null;
  intExt: IntExt | null;
  /** ИНТ/НАТ как в файле, в верхнем регистре: «ИНТ.», «ИНТ/НАТ», «INT.». */
  intExtToken: string | null;
  /** Место как в файле, в верхнем регистре, разделители сохранены. */
  place: string;
  locations: HeadingLocation[];
  /** Режим из словаря (ключ `TIME_WORDS`). */
  time: string | null;
  /** Хвост после тире для текста шапки: «УТРО», «НЕМНОГО ПОЗЖЕ». */
  tail: string | null;
  /** Пометка: «ПОЗЖЕ», «СЛЕДУЮЩЕЕ УТРО». */
  note: string | null;
  /** Пометка стоит вместо режима — режим от предыдущей шапки. */
  noteInsteadOfTime: boolean;
  /** Пометка в скобках после режима: «(ПОЗЖЕ)». */
  parenNote: string | null;
  serviceObject: boolean;
};

const NUMBER_RE = /^(?:(?:СЦЕНА|СЦ|SCENE|SC)\.?\s*)?(\d+)([A-ZА-ЯЁ])?(?=[\s.)]|$)[.)]?\s*/u;
const INT_EXT_TOKEN = "(?:ИНТЕРЬЕР|ИНТ|НАТУРА|НАТ|INT|EXT)";
const INT_EXT_RE = new RegExp(
  String.raw`^(${INT_EXT_TOKEN}\.?(?:\s*[/\-–—]\s*${INT_EXT_TOKEN}\.?)?)(?=[\s./\-—]|$)(\.?)\s*`,
  "u",
);

function intExtOf(token: string): IntExt | null {
  const parts = token
    .split(/[/\-–—]/)
    .map((part) => part.replace(/\./g, "").trim())
    .filter(Boolean);
  const kinds = new Set(
    parts.map((part) => (part.startsWith("ИНТ") || part === "INT" ? "INT" : "EXT")),
  );
  if (parts.length >= 2) return "INT_EXT";
  return kinds.has("INT") ? "INT" : kinds.has("EXT") ? "EXT" : null;
}

function noteOf(text: string) {
  const key = compareKey(text.replace(/\.+$/, ""));
  return HEADING_NOTES.find((note) => compareKey(note.text) === key) ?? null;
}

function timeOf(text: string) {
  const key = compareKey(text.replace(/\.+$/, ""));
  return key in TIME_WORDS ? key : null;
}

/** Первый разделитель объекта и подобъекта: «/» без пробелов или точка. */
function splitObject(part: string): { object: string; sub: string | null } {
  for (let i = 0; i < part.length; i++) {
    const ch = part[i];
    if (ch !== "/" && ch !== ".") continue;
    const before = part.slice(0, i);
    const after = part.slice(i + 1);
    if (!after.trim() || !before.trim()) continue;
    if (ch === ".") {
      if (/\d$/.test(before) && /^\d/.test(after)) continue;
      const lastWord = before.match(/[\p{L}-]+$/u)?.[0] ?? "";
      if (PLACE_ABBREVIATIONS.includes(lastWord)) continue;
    }
    return { object: before.trim(), sub: after.trim() };
  }
  return { object: part.trim(), sub: null };
}

/**
 * Место → объекты и подобъекты. «///» — ещё подобъект того же объекта.
 * « / » — подобъект, если у первого объекта уже есть подобъект; иначе новый объект (вопрос).
 */
export function parsePlace(place: string): HeadingLocation[] {
  const pieces = place.split(/(\s*\/{2,}\s*|\s+\/\s+)/u);
  const first = pieces[0]?.trim() ?? "";
  if (!first) return [];
  let current = { ...splitObject(first), separate: false };
  const result: HeadingLocation[] = [current];

  for (let i = 1; i + 1 < pieces.length; i += 2) {
    const multi = pieces[i]!.trim().length >= 2;
    const part = pieces[i + 1]!.trim();
    if (!part) continue;
    const parsed = splitObject(part);
    if (parsed.sub != null) {
      current = { ...parsed, separate: true };
      result.push(current);
    } else if (multi || current.sub != null) {
      result.push({ object: current.object, sub: parsed.object, separate: current.separate });
    } else {
      current = { object: parsed.object, sub: null, separate: true };
      result.push(current);
    }
  }
  return result;
}

/**
 * Шапка сцены → номер · ИНТ/НАТ · объект · подобъекты · режим · пометка.
 * На входе текст после замены символов. `mapPlace` — правки слов места (латиница) до разбора.
 */
export function parseHeading(
  source: string,
  mapPlace: (place: string) => string = (place) => place,
): ParsedHeading {
  let rest = cleanSpaces(source).toUpperCase();

  let number: string | null = null;
  const numberMatch = rest.match(NUMBER_RE);
  if (numberMatch) {
    number = numberMatch[1]! + (numberMatch[2] ? sceneLetter(numberMatch[2]) : "");
    rest = rest.slice(numberMatch[0].length);
  }

  let intExt: IntExt | null = null;
  let intExtToken: string | null = null;
  const intExtMatch = rest.match(INT_EXT_RE);
  if (intExtMatch) {
    intExtToken = (intExtMatch[1]! + intExtMatch[2]!).replace(/\s+/g, "");
    intExt = intExtOf(intExtToken);
    rest = rest.slice(intExtMatch[0].length);
  }
  rest = rest.trim();

  let parenNote: string | null = null;
  let note: string | null = null;
  const paren = rest.match(/\s*\(([^()]*)\)$/u);
  if (paren && noteOf(paren[1]!)) {
    note = noteOf(paren[1]!)!.text;
    parenNote = `(${cleanSpaces(paren[1]!)})`;
    rest = rest.slice(0, paren.index).trim();
  }

  let time: string | null = null;
  let tail: string | null = null;
  let noteInsteadOfTime = false;
  const dash = rest.match(/^(.*)—\s*([^—]+)$/u);
  if (dash) {
    const candidate = dash[2]!.trim().replace(/\.+$/, "");
    const word = timeOf(candidate);
    const tailNote = word ? null : noteOf(candidate);
    if (word || tailNote) {
      tail = candidate;
      rest = dash[1]!.trim();
      if (word) {
        time = word;
      } else {
        note = tailNote!.text;
        time = tailNote!.time ?? null;
        noteInsteadOfTime = !time;
      }
    }
  } else {
    const words = rest.split(" ");
    const last = words.length >= 2 ? timeOf(words[words.length - 1]!) : null;
    if (last) {
      time = last;
      tail = words[words.length - 1]!.replace(/\.+$/, "");
      rest = words.slice(0, -1).join(" ");
    }
  }

  const place = mapPlace(rest.replace(/[\s.]+$/u, "").trim());
  const locations = parsePlace(place);
  const firstObject = locations[0] ? compareKey(locations[0].object) : "";

  return {
    number,
    intExt,
    intExtToken,
    place,
    locations,
    time,
    tail,
    note,
    noteInsteadOfTime,
    parenNote,
    serviceObject: SERVICE_OBJECTS.some((word) => compareKey(word) === firstObject),
  };
}

/** Шапка из одного номера («37.») — не сцена. */
export function isNumberOnly(heading: ParsedHeading) {
  return (
    !heading.intExtToken && !heading.place && !heading.tail && !heading.parenNote
  );
}

/** Текст шапки после нормализации. Режим всегда через « — ». */
export function formatHeading(
  heading: ParsedHeading,
  number: string | null,
  tail: string | null,
) {
  const head = [number ? `${number}.` : null, heading.intExtToken, heading.place || null]
    .filter(Boolean)
    .join(" ");
  return [head, tail ? `— ${tail}` : null, heading.parenNote].filter(Boolean).join(" ");
}
