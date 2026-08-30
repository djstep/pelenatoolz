import type { DayNight, IntExt } from "@prisma/client";

export type ParsedScene = {
  episodeNumber: number;
  number: string;
  postfix: string;
  location?: string;
  intExt?: IntExt;
  dayNight?: DayNight;
  characters: string[];
  script?: string;
  timing?: string;
  scriptDay?: number;
};

const DAY_NIGHT_MAP: Record<string, DayNight> = {
  день: "DAY",
  day: "DAY",
  ночь: "NIGHT",
  night: "NIGHT",
  рассвет: "DAWN",
  утро: "DAWN",
  dawn: "DAWN",
  закат: "DUSK",
  вечер: "DUSK",
  dusk: "DUSK",
};

const INT_EXT_TOKEN =
  "(?:ИНТ(?:ЕРЬЕР)?|НАТ(?:УРА)?|НАР\\.?|INT|EXT|ЭКСТ(?:ЕРЬЕР)?)";

/**
 * Scene heading variants:
 * - `1. ИНТ. ЛОКАЦИЯ – ДЕНЬ`
 * - `INT. LOCATION - DAY` (Final Draft / Fountain)
 * - `.INT. LOCATION - DAY` (Fountain forced)
 */
const HEADING_RE = new RegExp(
  String.raw`(?:^|\n)\s*(?:(?:(\d+)\s*[\-–—−]\s*)?(\d+)([A-Za-zА-Яа-я])?\s*[.\)]?\s+)?\.?\s*(${INT_EXT_TOKEN}(?:\s*/\s*${INT_EXT_TOKEN})?)\.?\s*([^\n]+)`,
  "giu",
);

function mapIntExt(raw: string): IntExt | undefined {
  const parts = raw
    .replace(/\./g, "")
    .split("/")
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean)
    .map((p) => {
      if (p.startsWith("ИНТ") || p === "INT") return "INT";
      if (
        p.startsWith("НАТ") ||
        p.startsWith("НАР") ||
        p.startsWith("ЭКСТ") ||
        p === "EXT"
      ) {
        return "EXT";
      }
      return p;
    });

  if (parts.length === 0) return undefined;
  if (parts.length >= 2) return "INT_EXT";
  if (parts[0] === "INT") return "INT";
  if (parts[0] === "EXT") return "EXT";
  return undefined;
}

function mapDayNight(raw: string): DayNight | undefined {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "")
    .replace(/\s+/g, " ");
  return DAY_NIGHT_MAP[key];
}

function splitLocationAndMode(rest: string): {
  location: string;
  dayNight?: DayNight;
} {
  const cleaned = rest.replace(/\s+/g, " ").trim();
  const dash = cleaned.match(/^(.+?)\s*[–—−-]\s*([^–—−-]+)$/u);
  if (dash) {
    const location = dash[1]!.trim();
    const modeRaw = dash[2]!.trim();
    const dayNight = mapDayNight(modeRaw);
    if (dayNight) {
      return { location, dayNight };
    }
  }

  const tokens = cleaned.split(/\s+/);
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1]!;
    const dayNight = mapDayNight(last);
    if (dayNight) {
      return {
        location: tokens.slice(0, -1).join(" "),
        dayNight,
      };
    }
  }

  return { location: cleaned };
}

/** Single cast name (any case): мама, МАМА, Mary-Jane — max 2 words */
function isCharacterName(name: string): boolean {
  const n = name.trim().replace(/\.+$/, "");
  if (n.length < 2 || n.length > 40) return false;
  if (/\d/.test(n)) return false;
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return false;
  return words.every((w) =>
    /^[А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z\-']*$/u.test(w),
  );
}

function isCharacterLine(line: string): boolean {
  if (line.length > 120) return false;
  if (/(?:ИНТ|НАТ|INT|EXT)\.?/i.test(line) && /^\d/.test(line)) return false;
  const names = line.split(/[,;]/).map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return false;
  return names.every(isCharacterName);
}

function parseCharacterNames(line: string): string[] {
  return line
    .split(/[,;]/)
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => n.toUpperCase());
}

/**
 * Pull cast list from the first body line.
 * Supports:
 * - `МАМА, АННА, СОФИЯ`
 * - `мама, папа, анна, софия` (lowercase from Word)
 * - `мама, папа, анна, софия Анна входит…` (cast glued to action)
 */
function extractLeadingCharacters(line: string): {
  characters: string[];
  rest?: string;
} | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 240) return null;
  if (/(?:ИНТ|НАТ|INT|EXT)\.?/i.test(trimmed) && /^\d/.test(trimmed)) {
    return null;
  }

  if (isCharacterLine(trimmed)) {
    return { characters: parseCharacterNames(trimmed) };
  }

  const parts = trimmed.split(/\s*,\s*/);
  if (parts.length < 2) return null;

  const characters: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!.trim();
    const isLast = i === parts.length - 1;

    if (!isLast) {
      if (!isCharacterName(part)) return null;
      characters.push(part.toUpperCase());
      continue;
    }

    const words = part.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
      if (!isCharacterName(part)) return null;
      characters.push(part.toUpperCase());
      return { characters };
    }

    const first = words[0]!;
    const rest = words.slice(1).join(" ");
    if (!isCharacterName(first) || rest.length < 2) return null;

    // Rest looks like prose/action (has lowercase or several words)
    const looksLikeAction =
      /[а-яёa-z]/.test(rest) || rest.split(/\s+/).length >= 2;
    if (!looksLikeAction) return null;

    characters.push(first.toUpperCase());
    return { characters, rest };
  }

  return characters.length ? { characters } : null;
}

function sanitizeSceneNumber(raw: string | undefined, sceneIndex: number) {
  if (!raw) return String(sceneIndex + 1);
  // Title pages often contain a year that gets mistaken for scene number.
  if (/^(19|20)\d{2}$/.test(raw)) return String(sceneIndex + 1);
  return raw;
}

function sanitizeEpisodeNumber(raw: string | undefined) {
  if (!raw) return 0;
  const episode = Number(raw);
  if (!Number.isFinite(episode) || episode <= 0) return 0;
  if (episode >= 1900 && episode <= 2099) return 0;
  return episode;
}

function formatSeconds(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Normalize Word quirks before parsing */
export function normalizeScriptText(text: string): string {
  return text
    .replace(/\u000b|\u000c|\u2028|\u2029/g, "\n")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0|\u202f|\u2007|\u2009/g, " ")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/[‐‑‒–—−]/g, "–")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function applyTiming(
  scenes: ParsedScene[],
  timingMethod: string,
  pageRatio: number,
) {
  for (const scene of scenes) {
    if (timingMethod === "none") {
      scene.timing = undefined;
    } else if (timingMethod === "words") {
      const words = (scene.script ?? "").split(/\s+/).filter(Boolean).length;
      scene.timing = formatSeconds(Math.round(words / 2));
    } else if (timingMethod === "pages") {
      const pages = Math.max(0.25, (scene.script?.length ?? 0) / 1500);
      scene.timing = formatSeconds(Math.round(pages * pageRatio * 60));
    } else if (timingMethod === "file") {
      const tm = scene.script?.match(/\((\d{1,2}:\d{2})\)/);
      scene.timing = tm?.[1];
    }
    if (scene.script) scene.script = scene.script.trim();
  }
}

export function parseScenesFromText(
  text: string,
  timingMethod: string,
  pageRatio: number,
): ParsedScene[] {
  const normalized = normalizeScriptText(text);
  const matches = [...normalized.matchAll(HEADING_RE)];

  if (matches.length === 0) {
    return [];
  }

  const scenes: ParsedScene[] = [];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = (m.index ?? 0) + m[0].length;
    const end =
      i + 1 < matches.length
        ? (matches[i + 1]!.index ?? normalized.length)
        : normalized.length;
    const body = normalized.slice(start, end).trim();
    const bodyLines = body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const { location, dayNight } = splitLocationAndMode(m[5] ?? "");
    const characters: string[] = [];
    const scriptLines: string[] = [];

    // Cast list can be on the 1st–3rd body line (after blank/timing quirks).
    let castResolved = false;
    for (let li = 0; li < bodyLines.length; li++) {
      const line = bodyLines[li]!;
      if (!castResolved && li < 4) {
        const extracted = extractLeadingCharacters(line);
        if (extracted && extracted.characters.length > 0) {
          characters.push(...extracted.characters);
          castResolved = true;
          if (extracted.rest) scriptLines.push(extracted.rest);
          continue;
        }
        // Skip ultra-short timing markers like "(00:33)" before cast
        if (/^\(?\d{1,2}:\d{2}\)?$/.test(line) || /^\(\d+\)$/.test(line)) {
          scriptLines.push(line);
          continue;
        }
      }
      castResolved = true;
      scriptLines.push(line);
    }

    // Fallback: collect uppercase cue names that look like cast (not dialogue blocks)
    if (characters.length === 0) {
      const cues = new Set<string>();
      for (const line of bodyLines.slice(0, 12)) {
        if (isCharacterLine(line) && !line.includes(",")) {
          for (const n of parseCharacterNames(line)) cues.add(n);
        }
      }
      characters.push(...cues);
    }

    scenes.push({
      episodeNumber: sanitizeEpisodeNumber(m[1]),
      number: sanitizeSceneNumber(m[2], i),
      postfix: m[3] ?? "",
      location,
      intExt: mapIntExt(m[4] ?? ""),
      dayNight,
      characters: [...new Set(characters)],
      script: scriptLines.join("\n"),
    });
  }

  applyTiming(scenes, timingMethod, pageRatio);
  return scenes;
}

export function previewExtractedText(text: string, max = 400): string {
  const n = normalizeScriptText(text).replace(/\n/g, "↵");
  if (n.length <= max) return n;
  return `${n.slice(0, max)}…`;
}
