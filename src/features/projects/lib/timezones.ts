export type TimezoneOption = {
  value: string;
  label: string;
  search: string;
};

const ALL_TIMEZONES = Intl.supportedValuesOf("timeZone");

function formatTimezoneOffset(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function buildTimezoneOption(timezone: string): TimezoneOption {
  const offset = formatTimezoneOffset(timezone);
  const label = offset ? `${timezone} (${offset})` : timezone;
  return {
    value: timezone,
    label,
    search: `${timezone} ${offset}`.toLowerCase(),
  };
}

const TIMEZONE_OPTIONS = ALL_TIMEZONES.map(buildTimezoneOption);

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}

export function searchTimezones(query: string, limit = 12): TimezoneOption[] {
  const q = normalizeQuery(query);
  if (!q) return [];

  const prefixSegment: TimezoneOption[] = [];
  const prefixFull: TimezoneOption[] = [];
  const includes: TimezoneOption[] = [];

  for (const option of TIMEZONE_OPTIONS) {
    const segments = option.value.toLowerCase().split("/");
    if (segments.some((segment) => segment.startsWith(q))) {
      prefixSegment.push(option);
      continue;
    }
    if (option.value.toLowerCase().startsWith(q)) {
      prefixFull.push(option);
      continue;
    }
    if (option.search.includes(q)) {
      includes.push(option);
    }
  }

  return [...prefixSegment, ...prefixFull, ...includes].slice(0, limit);
}

export function isValidTimezone(value: string) {
  if (!value.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isValidTimezone(trimmed)) return trimmed;

  const matches = searchTimezones(trimmed, 1);
  return matches[0]?.value ?? null;
}

export function timezoneLabel(value: string) {
  if (!isValidTimezone(value)) return value;
  return buildTimezoneOption(value).label;
}
