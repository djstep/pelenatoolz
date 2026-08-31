/** Normalize a screenplay cue line for comparison (trim, drop trailing dots). */
export function normalizeCueLine(text: string): string {
  return text.trim().replace(/\.+$/, "").replace(/\s+/g, " ");
}

const EXACT_STAGE_DIRECTIONS = new Set([
  "black screen",
  "white screen",
  "черный экран",
  "чёрный экран",
  "белый экран",
  "fade in",
  "fade out",
  "fade to black",
  "fade to white",
  "затемнение",
  "cut to",
  "dissolve to",
  "match cut",
  "the end",
  "конец",
  "montage",
  "монтаж",
  "intercut",
  "later",
  "позже",
  "continuous",
  "непрерывно",
  "end credits",
  "титры",
  "title card",
  "надпись",
  "super",
  "сверху",
]);

const STAGE_DIRECTION_PATTERNS = [
  /^(?:fade|dissolve)\s+(?:in|out|to(?:\s+\w+)?)$/iu,
  /^(?:cut|match cut|smash cut)\s+to$/iu,
  /^(?:чёрный|черный|белый)\s+экран$/iu,
];

/**
 * Lines that look like character cues (short, centered, caps) but are
 * transitions / visual directions — not cast names.
 */
export function isStageDirectionLine(text: string): boolean {
  const normalized = normalizeCueLine(text).toLowerCase();
  if (!normalized) return false;
  if (EXACT_STAGE_DIRECTIONS.has(normalized)) return true;
  return STAGE_DIRECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}
