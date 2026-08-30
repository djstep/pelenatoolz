import type { DayNight, IntExt } from "@prisma/client";
import { dayNightLabels, intExtLabels } from "@/shared/i18n/domain-labels";

const INT_EXT_TOKEN =
  "(?:ИНТ(?:ЕРЬЕР)?|НАТ(?:УРА)?|НАР\\.?|INT|EXT|ЭКСТ(?:ЕРЬЕР)?)";

const SLUGLINE_RE = new RegExp(
  String.raw`^\s*(?:(?:(\d+)\s*[\-–—−]\s*)?(\d+)([A-Za-zА-Яа-я])?\s*[.\)]?\s+)?\.?\s*(${INT_EXT_TOKEN}(?:\s*/\s*${INT_EXT_TOKEN})?)\.?\s*(.+)$`,
  "iu",
);

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
    const dayNight = mapDayNight(dash[2]!);
    if (dayNight) return { location, dayNight };
  }

  const tokens = cleaned.split(/\s+/);
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1]!;
    const dayNight = mapDayNight(last);
    if (dayNight) {
      return { location: tokens.slice(0, -1).join(" "), dayNight };
    }
  }

  return { location: cleaned };
}

export type ParsedSlugline = {
  episodeNumber: number;
  number: string;
  postfix: string;
  intExt?: IntExt;
  dayNight?: DayNight;
  location: string;
};

export function parseSlugline(text: string): ParsedSlugline | null {
  const match = text.trim().match(SLUGLINE_RE);
  if (!match) return null;

  const { location, dayNight } = splitLocationAndMode(match[5] ?? "");
  return {
    episodeNumber: match[1] ? Number(match[1]) : 0,
    number: match[2] ?? "1",
    postfix: match[3] ?? "",
    intExt: mapIntExt(match[4] ?? ""),
    dayNight,
    location,
  };
}

function intExtToSlug(value: IntExt) {
  if (value === "INT") return "ИНТ.";
  if (value === "EXT") return "НАТ.";
  return "ИНТ./НАТ.";
}

function dayNightToSlug(value: DayNight) {
  return dayNightLabels[value]?.toUpperCase() ?? value;
}

export function buildSlugline(input: {
  episodeNumber: number;
  number: string;
  postfix: string;
  intExt?: IntExt | null;
  dayNight?: DayNight | null;
  location?: string | null;
}) {
  const num =
    input.episodeNumber > 0
      ? `${input.episodeNumber}-${input.number}${input.postfix}`
      : `${input.number}${input.postfix}`;
  const ie = input.intExt ? intExtToSlug(input.intExt) : "ИНТ.";
  const loc = input.location?.trim() || "ЛОКАЦИЯ";
  const dn = input.dayNight ? dayNightToSlug(input.dayNight) : "ДЕНЬ";
  return `${num}. ${ie} ${loc} – ${dn}`;
}

export function intExtLabel(value?: IntExt | null) {
  return value ? intExtLabels[value] : undefined;
}
