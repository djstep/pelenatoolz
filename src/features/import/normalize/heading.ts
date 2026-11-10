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
  /** Хронометраж в конце шапки: «(02:05)» → 125. Текст шапки его сохраняет, разбор и ключи нет. */
  fileSeconds: number | null;
  /** Та же метка как в файле. */
  fileTimeText: string | null;
  /** В файле время стояло перед пометкой: «(00:15) (ПОЗЖЕ)». */
  fileTimeBeforeNote: boolean;
  serviceObject: boolean;
};

/** «(ММ:СС)» или «(Ч:ММ:СС)» в самом конце шапки. */
const FILE_TIME_RE = /\s*\(\s*(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)\s*\)$/u;

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

/**
 * Как читать «/» без пробелов. Обычно — как « / » (смежные места: «ДОМ. ДЕТСКАЯ/КОРИДОР»,
 * «ДВОР ДОМА/ОПУШКА ЛЕСА»). В файлах старой записи («КВАРТИРА/СПАЛЬНЯ///КОРИДОР», где есть «///»)
 * — «/» без пробелов отделяет подобъект от объекта (решение владельца: правило по файлу).
 */
export type PlaceRules = { legacySlash?: boolean };

/** Старая запись: в тексте есть «///» — «/» без пробелов отделяет подобъект. */
export function usesLegacySlash(texts: Iterable<string>): boolean {
  for (const text of texts) if (/\/{3,}/.test(text)) return true;
  return false;
}

/**
 * Первый разделитель объекта и подобъекта — точка («ДОМ. КУХНЯ»), кроме сокращений («КВ. ИВАНА»)
 * и чисел («1.2»); в старой записи — ещё «/» без пробелов («КВАРТИРА/СПАЛЬНЯ»).
 */
function splitObject(part: string, rules: PlaceRules): { object: string; sub: string | null } {
  for (let i = 0; i < part.length; i++) {
    const ch = part[i];
    if (ch !== "." && !(ch === "/" && rules.legacySlash)) continue;
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
 * « / » (и «/» без пробелов, кроме старой записи) — подобъект, если у первого объекта уже есть
 * подобъект; иначе новый объект (вопрос). «/» между цифрами («1/2») не делит.
 */
export function parsePlace(place: string, rules: PlaceRules = {}): HeadingLocation[] {
  const pieces = place.split(
    rules.legacySlash ? /(\s*\/{2,}\s*|\s+\/\s+)/u : /(\s*\/{2,}\s*|(?<!\d)\s*\/\s*(?!\d))/u,
  );
  const first = pieces[0]?.trim() ?? "";
  if (!first) return [];
  let current = { ...splitObject(first, rules), separate: false };
  const result: HeadingLocation[] = [current];

  for (let i = 1; i + 1 < pieces.length; i += 2) {
    const multi = pieces[i]!.trim().length >= 2;
    const part = pieces[i + 1]!.trim();
    if (!part) continue;
    const parsed = splitObject(part, rules);
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
  rules: PlaceRules = {},
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

  // Время снимается до разбора хвоста: иначе «РАССВЕТ (00:15)» не распознаётся как режим.
  let fileSeconds: number | null = null;
  let fileTimeText: string | null = null;
  let fileTimeBeforeNote = false;
  const takeFileTime = () => {
    const found = rest.match(FILE_TIME_RE);
    if (!found) return false;
    fileSeconds = Number(found[1] ?? 0) * 3600 + Number(found[2]) * 60 + Number(found[3]);
    fileTimeText = found[0].trim();
    rest = rest.slice(0, found.index).trim();
    return true;
  };
  takeFileTime();

  let parenNote: string | null = null;
  let note: string | null = null;
  const paren = rest.match(/\s*\(([^()]*)\)$/u);
  if (paren && noteOf(paren[1]!)) {
    note = noteOf(paren[1]!)!.text;
    parenNote = `(${cleanSpaces(paren[1]!)})`;
    rest = rest.slice(0, paren.index).trim();
    // Обратный порядок: «(00:15) (ПОЗЖЕ)».
    fileTimeBeforeNote = takeFileTime();
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
  const locations = parsePlace(place, rules);
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
    fileSeconds,
    fileTimeText,
    fileTimeBeforeNote,
    serviceObject: SERVICE_OBJECTS.some((word) => compareKey(word) === firstObject),
  };
}

/** Шапка из одного номера («37.») — не сцена. */
export function isNumberOnly(heading: ParsedHeading) {
  return (
    !heading.intExtToken &&
    !heading.place &&
    !heading.tail &&
    !heading.parenNote &&
    heading.fileSeconds == null
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

/** Текст шапки как в файле: `formatHeading` и метка времени. Для ключей сравнения метка не нужна. */
export function headingText(heading: ParsedHeading, number: string | null, tail: string | null) {
  const base = formatHeading({ ...heading, parenNote: null }, number, tail);
  const marks = heading.fileTimeBeforeNote
    ? [heading.fileTimeText, heading.parenNote]
    : [heading.parenNote, heading.fileTimeText];
  return [base, ...marks].filter(Boolean).join(" ");
}
