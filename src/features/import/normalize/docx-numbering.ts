/** Автонумерация списков Word (`numbering.xml`): считаем только простые десятичные списки. */

export type AutoNumber =
  | { kind: "number"; value: number; label: string }
  /** Нумерация есть, но посчитать её нельзя (не десятичная, составная, нет описания). */
  | { kind: "unreadable" };

type LevelDef = { start: number; numFmt: string | null; lvlText: string | null };

type NumDef = {
  abstractId: string;
  startOverrides: Map<number, number>;
};

export type Numbering = {
  nums: Map<string, NumDef>;
  abstracts: Map<string, Map<number, LevelDef>>;
};

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1]! : null;
}

function valOf(body: string, tagName: string): string | null {
  const tag = body.match(new RegExp(`<w:${tagName}\\b[^>]*\\/>`))?.[0];
  return tag ? attr(tag, "w:val") : null;
}

export function parseNumbering(xml: string | null): Numbering {
  const nums = new Map<string, NumDef>();
  const abstracts = new Map<string, Map<number, LevelDef>>();
  if (!xml) return { nums, abstracts };

  for (const match of xml.matchAll(/<w:abstractNum\b([^>]*)>([\s\S]*?)<\/w:abstractNum>/g)) {
    const id = attr(match[1]!, "w:abstractNumId");
    if (id == null) continue;
    const levels = new Map<number, LevelDef>();
    for (const lvl of match[2]!.matchAll(/<w:lvl\b([^>]*)>([\s\S]*?)<\/w:lvl>/g)) {
      const ilvl = Number(attr(lvl[1]!, "w:ilvl") ?? "0");
      const body = lvl[2]!;
      levels.set(ilvl, {
        start: Number(valOf(body, "start") ?? "1"),
        numFmt: valOf(body, "numFmt"),
        lvlText: valOf(body, "lvlText"),
      });
    }
    abstracts.set(id, levels);
  }

  for (const match of xml.matchAll(/<w:num\b([^>]*)>([\s\S]*?)<\/w:num>/g)) {
    const id = attr(match[1]!, "w:numId");
    const abstractId = valOf(match[2]!, "abstractNumId");
    if (id == null || abstractId == null) continue;
    const startOverrides = new Map<number, number>();
    for (const override of match[2]!.matchAll(
      /<w:lvlOverride\b([^>]*)>([\s\S]*?)<\/w:lvlOverride>/g,
    )) {
      const start = valOf(override[2]!, "startOverride");
      if (start != null) {
        startOverrides.set(Number(attr(override[1]!, "w:ilvl") ?? "0"), Number(start));
      }
    }
    nums.set(id, { abstractId, startOverrides });
  }

  return { nums, abstracts };
}

/**
 * Счётчик номеров по документу: вызывать для каждого нумерованного абзаца по порядку.
 * Списки с одним описанием продолжают общий счёт, если у списка нет своего «начать с».
 */
export function createListCounter(numbering: Numbering) {
  const counters = new Map<string, number[]>();

  return function next(numId: string, ilvl: number): AutoNumber | null {
    if (numId === "0") return null; // явное «без нумерации»
    const num = numbering.nums.get(numId);
    const level = num ? numbering.abstracts.get(num.abstractId)?.get(ilvl) : undefined;
    if (!num || !level) return { kind: "unreadable" };

    const key = num.startOverrides.size > 0 ? `num:${numId}` : `abstract:${num.abstractId}`;
    const counts = counters.get(key) ?? [];
    const start = num.startOverrides.get(ilvl) ?? level.start;
    const value = counts[ilvl] == null ? start : counts[ilvl]! + 1;
    counts[ilvl] = value;
    counts.length = ilvl + 1; // более глубокие уровни начинаются заново
    counters.set(key, counts);

    const placeholder = `%${ilvl + 1}`;
    const text = level.lvlText ?? "";
    const simple =
      level.numFmt === "decimal" &&
      text.includes(placeholder) &&
      (text.match(/%\d/g) ?? []).length === 1;
    if (!simple) return { kind: "unreadable" };
    return { kind: "number", value, label: text.replace(placeholder, String(value)) };
  };
}
