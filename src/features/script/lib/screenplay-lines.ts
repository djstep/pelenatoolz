import { isStageDirectionLine } from "@/features/screenplay/lib/stage-directions";

/**
 * Screenplay line classification for display (plain-text script bodies).
 */

function isCharacterName(name: string): boolean {
  const n = name.trim().replace(/\.+$/, "");
  if (isStageDirectionLine(n)) return false;
  if (n.length < 2 || n.length > 40) return false;
  if (/\d/.test(n)) return false;
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return false;
  return words.every((w) =>
    /^[А-ЯЁа-яёA-Za-z][А-ЯЁа-яёA-Za-z\-']*$/u.test(w),
  );
}

export function isScreenplayCharacterLine(line: string): boolean {
  if (isStageDirectionLine(line)) return false;
  if (line.length > 120) return false;
  if (/(?:ИНТ|НАТ|INT|EXT)\.?/i.test(line) && /^\d/.test(line)) return false;
  const names = line.split(/[,;]/).map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return false;
  return names.every(isCharacterName);
}

function isParenthetical(line: string): boolean {
  const t = line.trim();
  return t.startsWith("(") && t.endsWith(")");
}

export type ScriptLineType =
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "blank";

export type ClassifiedScriptLine = {
  type: ScriptLineType;
  text: string;
};

export function classifyScriptLines(text: string): ClassifiedScriptLine[] {
  const lines = text.split("\n");
  const result: ClassifiedScriptLine[] = [];
  let prev: ScriptLineType | "start" = "start";

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      result.push({ type: "blank", text: "" });
      prev = "start";
      continue;
    }

    if (isParenthetical(trimmed)) {
      result.push({ type: "parenthetical", text: trimmed });
      prev = "parenthetical";
      continue;
    }

    if (
      (prev === "start" || prev === "action" || prev === "dialogue") &&
      isScreenplayCharacterLine(trimmed)
    ) {
      result.push({ type: "character", text: trimmed });
      prev = "character";
      continue;
    }

    if (prev === "character" || prev === "parenthetical") {
      result.push({ type: "dialogue", text: trimmed });
      prev = "dialogue";
      continue;
    }

    result.push({ type: "action", text: trimmed });
    prev = "action";
  }

  return result;
}
