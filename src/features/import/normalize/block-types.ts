import type { ScriptBlockType } from "@prisma/client";
import type { AutoNumber } from "@/features/import/normalize/docx-numbering";
import type { DocxParagraph } from "@/features/import/normalize/docx-paragraphs";
import { isStageDirectionLine } from "@/features/screenplay/lib/stage-directions";

/** Типы блоков, которые даёт импорт. SHOT и GENERAL из Word становятся действием. */
export type ImportBlockType = Extract<
  ScriptBlockType,
  | "SLUGLINE"
  | "SCENE_CAST"
  | "ACTION"
  | "CHARACTER"
  | "DIALOGUE"
  | "PARENTHETICAL"
  | "TRANSITION"
  | "NOTE"
>;

/** Чем определён тип: стилем Word, профилем отступов или текстом. */
export type TypeLevel = "style" | "indent" | "text";

export type TypedBlock = {
  paragraphIndex: number;
  /** Текст абзаца как в файле. Нормализация — следующим слоем. */
  text: string;
  type: ImportBlockType;
  level: TypeLevel;
  /** Название стиля Word, по которому определён тип. */
  styleName?: string;
  /** Абзац до первой шапки сцены — кандидат в титульную страницу. */
  beforeFirstScene: boolean;
  /** Номер из автонумерации Word (для шапок — номер сцены). */
  autoNumber: AutoNumber | null;
};

export type TypeConflictReason =
  /** Стиль говорит одно, а текст похож на шапку сцены. */
  | "looks_like_slugline"
  /** Стиль или отступ говорит «персонаж», а текст похож на обычную фразу. */
  | "character_looks_like_prose";

export type TypeConflict = {
  paragraphIndex: number;
  text: string;
  assigned: ImportBlockType;
  suggested: ImportBlockType;
  level: Exclude<TypeLevel, "text">;
  reason: TypeConflictReason;
};

/** Пустой абзац со стилем сценария (например, пустая шапка) — выброшен. */
export type DroppedParagraph = {
  paragraphIndex: number;
  type: ImportBlockType;
};

/** Профиль левых отступов (twips), найденный по файлу. */
export type IndentProfile = {
  character: number;
  dialogue: number;
  parenthetical: number | null;
};

/** Пометки для экрана проверки, не привязанные к одному блоку. */
export type TypingNotice = {
  /** Номера сцен заданы автонумерацией Word и не прочитаны. */
  code: "slugline_autonumber_unreadable";
  paragraphIndexes: number[];
};

export type BlockTypingResult = {
  blocks: TypedBlock[];
  conflicts: TypeConflict[];
  dropped: DroppedParagraph[];
  indentProfile: IndentProfile | null;
  notices: TypingNotice[];
};

/**
 * Стили Word → тип блока. Ключ — название или id стиля без регистра, пробелов,
 * дефисов и подчёркиваний, ё = е. Словарь расширяемый.
 */
export const WORD_STYLE_TYPES: Record<string, ImportBlockType> = {
  sceneheading: "SLUGLINE",
  action: "ACTION",
  character: "CHARACTER",
  dialogue: "DIALOGUE",
  parenthetical: "PARENTHETICAL",
  transition: "TRANSITION",
  shot: "ACTION",
  general: "ACTION",
  заголовоксцены: "SLUGLINE",
  описаниедействия: "ACTION",
  имягероя: "CHARACTER",
  реплика: "DIALOGUE",
  ремарка: "PARENTHETICAL",
  переход: "TRANSITION",
  персонажи: "SCENE_CAST",
};

/** Переходы: только целая строка из списка, в конце допускаются точка или двоеточие. */
export const TRANSITION_LINES = [
  "CUT TO",
  "FADE TO BLACK",
  "FADE OUT",
  "СМЕНА КАДРА",
  "ЗТМ",
  "ВЫХОД ИЗ ЗТМ",
  "ЗАТЕМНЕНИЕ",
];

/** Строка персонажей сцены без стиля «Персонажи»: сразу после шапки, «Персонажи: …». */
const CAST_LINE_RE = /^персонажи\s*:/iu;

/** Префиксы примечаний (не экранное время): «ПРЕФИКС: текст». */
export const NOTE_PREFIXES = ["РЕЖИССЕРСКАЯ ПОМЕТКА", "ПРИМЕЧАНИЕ", "NOTE"];

/** Ширина корзины при сравнении отступов: 0,2 см. */
const INDENT_BUCKET = 113;
/** Сколько абзацев нужно, чтобы отступ считался частью профиля. */
const MIN_PROFILE_LINES = 3;
const PROFILE_SHARE = 0.6;

function styleKey(value: string) {
  return value.toLowerCase().replace(/ё/g, "е").replace(/[\s_-]+/g, "");
}

/** Пробелы любого вида → один обычный, по краям — без пробелов. Только для проверок. */
function cleanForMatch(text: string) {
  return text
    .replace(/[    \t]/g, " ")
    .replace(/[​‌‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchKey(text: string) {
  return cleanForMatch(text).toUpperCase().replace(/Ё/g, "Е");
}

const SLUGLINE_RE =
  /^(?:(?:сц(?:ена)?|sc(?:ene)?)\.?\s*)?(?:\d+[a-zа-яё]?\s*[.)]?\s*)?(?:интерьер|инт|натура|нат|int|ext)(?=[\s./\-–—]|$)/iu;

export function isSluglineText(text: string) {
  return SLUGLINE_RE.test(cleanForMatch(text));
}

const TRANSITION_KEYS = new Set(TRANSITION_LINES.map((line) => matchKey(line)));

export function isTransitionText(text: string) {
  const key = matchKey(text).replace(/[.:]+$/, "").trim();
  return TRANSITION_KEYS.has(key);
}

export function isNoteText(text: string) {
  const key = matchKey(text);
  return NOTE_PREFIXES.some((prefix) => {
    const p = matchKey(prefix);
    return key.startsWith(p) && /^\s*:/.test(key.slice(p.length));
  });
}

export function isCastLineText(text: string) {
  return CAST_LINE_RE.test(cleanForMatch(text));
}

function isParentheticalText(text: string) {
  const t = cleanForMatch(text);
  return t.length >= 2 && t.startsWith("(") && t.endsWith(")");
}

/** Имя без скобок: «МАКСИМ (ПРОД.)» → «МАКСИМ». */
function nameWithoutParentheses(text: string) {
  return cleanForMatch(text.replace(/\([^)]*\)/g, " "));
}

/** Похоже на имя персонажа в любом регистре: коротко, без конечной точки. */
function isNameLike(text: string) {
  const name = nameWithoutParentheses(text);
  if (!name) return true; // «(ДАЛЬШЕ)» — разберёт нормализация
  if (name.length > 40) return false;
  if (name.split(" ").length > 4) return false;
  if (/[.!?…]$/.test(name)) return false;
  return /\p{L}/u.test(name);
}

/** Имя персонажа без стилей и отступов: только верхний регистр. */
function isUppercaseName(text: string) {
  const name = nameWithoutParentheses(text);
  if (!name || !isNameLike(text)) return false;
  if (/\p{Ll}/u.test(name)) return false;
  return !isStageDirectionLine(name);
}

function styleType(paragraph: DocxParagraph) {
  for (const [i, id] of paragraph.styleIds.entries()) {
    const name = paragraph.styleNames[i] ?? id;
    const type = WORD_STYLE_TYPES[styleKey(name)] ?? WORD_STYLE_TYPES[styleKey(id)];
    if (type) return { type, styleName: name };
  }
  return null;
}

function bucket(indent: number) {
  return Math.round(indent / INDENT_BUCKET);
}

/**
 * Профиль отступов по файлу: какой отступ у имён, реплик и ремарок.
 * Смотрим только абзацы без стиля сценария после первой шапки, без центровки.
 */
export function detectIndentProfile(paragraphs: DocxParagraph[]): IndentProfile | null {
  type Cluster = { lines: number; names: number; parens: number; indents: Map<number, number> };
  const clusters = new Map<number, Cluster>();

  for (const paragraph of paragraphs) {
    const text = cleanForMatch(paragraph.text);
    if (!text || paragraph.align === "center" || paragraph.align === "right") continue;
    if (isSluglineText(text) || isTransitionText(text) || isNoteText(text)) continue;
    const key = bucket(paragraph.indentLeft);
    if (key === 0) continue;
    const cluster = clusters.get(key) ?? { lines: 0, names: 0, parens: 0, indents: new Map() };
    cluster.lines += 1;
    if (isUppercaseName(text)) cluster.names += 1;
    if (isParentheticalText(text)) cluster.parens += 1;
    cluster.indents.set(
      paragraph.indentLeft,
      (cluster.indents.get(paragraph.indentLeft) ?? 0) + 1,
    );
    clusters.set(key, cluster);
  }

  const candidates = [...clusters.values()].filter((c) => c.lines >= MIN_PROFILE_LINES);
  const typical = (c: Cluster) =>
    [...c.indents.entries()].sort((a, b) => b[1] - a[1])[0]![0];

  const character = candidates
    .filter((c) => c.names / c.lines >= PROFILE_SHARE)
    .sort((a, b) => b.names / b.lines - a.names / a.lines)[0];
  if (!character) return null;

  const parenthetical = candidates
    .filter((c) => c !== character && c.parens / c.lines >= PROFILE_SHARE)
    .sort((a, b) => b.parens / b.lines - a.parens / a.lines)[0];

  const dialogue = candidates
    .filter(
      (c) =>
        c !== character &&
        c !== parenthetical &&
        typical(c) < typical(character),
    )
    .sort((a, b) => b.lines - a.lines)[0];
  if (!dialogue) return null;

  return {
    character: typical(character),
    dialogue: typical(dialogue),
    parenthetical: parenthetical ? typical(parenthetical) : null,
  };
}

function indentType(
  paragraph: DocxParagraph,
  profile: IndentProfile,
): ImportBlockType | null {
  const key = bucket(paragraph.indentLeft);
  if (key === 0) return null;
  if (key === bucket(profile.character)) return "CHARACTER";
  if (profile.parenthetical != null && key === bucket(profile.parenthetical)) {
    return "PARENTHETICAL";
  }
  if (key === bucket(profile.dialogue)) return "DIALOGUE";
  return null;
}

/** Уровень 3: тип по тексту и соседям. */
function textType(
  text: string,
  previous: ImportBlockType | null,
  next: string | null,
): ImportBlockType {
  if (isSluglineText(text)) return "SLUGLINE";
  if (isTransitionText(text)) return "TRANSITION";
  if (isNoteText(text)) return "NOTE";
  if (isParentheticalText(text)) return "PARENTHETICAL";
  if (
    previous !== "CHARACTER" &&
    next != null &&
    !isSluglineText(next) &&
    !isTransitionText(next) &&
    isUppercaseName(text)
  ) {
    return "CHARACTER";
  }
  if (previous === "CHARACTER" || previous === "PARENTHETICAL") return "DIALOGUE";
  return "ACTION";
}

/**
 * Тип каждого абзаца: стиль Word → профиль отступов → текст.
 * Уровни проверяют друг друга: расхождение попадает в `conflicts` (вопрос на экране проверки).
 */
export function classifyParagraphs(paragraphs: DocxParagraph[]): BlockTypingResult {
  const firstScene = paragraphs.findIndex(
    (p) => styleType(p)?.type === "SLUGLINE" || isSluglineText(p.text),
  );
  const sceneStart = firstScene < 0 ? paragraphs.length : firstScene;
  const indentProfile = detectIndentProfile(
    paragraphs.slice(sceneStart).filter((p) => !styleType(p)),
  );

  const blocks: TypedBlock[] = [];
  const conflicts: TypeConflict[] = [];
  const dropped: DroppedParagraph[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]!;
    const text = cleanForMatch(paragraph.text);
    const byStyle = styleType(paragraph);

    if (!text) {
      if (byStyle) dropped.push({ paragraphIndex: paragraph.index, type: byStyle.type });
      continue;
    }

    const base = {
      paragraphIndex: paragraph.index,
      text: paragraph.text,
      autoNumber: paragraph.autoNumber,
    };

    if (i < sceneStart && byStyle?.type !== "SLUGLINE") {
      blocks.push({ ...base, type: "ACTION", level: "text", beforeFirstScene: true });
      continue;
    }

    const previous = blocks.length > 0 ? blocks[blocks.length - 1]!.type : null;

    // «Персонажи: …» сразу после шапки — строка персонажей, даже без стиля.
    if (
      previous === "SLUGLINE" &&
      (!byStyle || byStyle.type === "ACTION") &&
      isCastLineText(text)
    ) {
      blocks.push({
        ...base,
        type: "SCENE_CAST",
        level: byStyle ? "style" : "text",
        styleName: byStyle?.styleName,
        beforeFirstScene: false,
      });
      continue;
    }

    if (byStyle) {
      // Примечание в стиле действия — всё равно примечание: это не экранное время.
      const type = byStyle.type === "ACTION" && isNoteText(text) ? "NOTE" : byStyle.type;
      blocks.push({
        ...base,
        type,
        level: "style",
        styleName: byStyle.styleName,
        beforeFirstScene: false,
      });
      addConflict(conflicts, paragraph, text, byStyle.type, "style");
      continue;
    }

    const special =
      isSluglineText(text) || isTransitionText(text) || isNoteText(text);
    const byIndent = indentProfile && !special ? indentType(paragraph, indentProfile) : null;
    if (byIndent) {
      blocks.push({ ...base, type: byIndent, level: "indent", beforeFirstScene: false });
      addConflict(conflicts, paragraph, text, byIndent, "indent");
      continue;
    }

    const next = paragraphs
      .slice(i + 1)
      .map((p) => cleanForMatch(p.text))
      .find(Boolean) ?? null;
    blocks.push({
      ...base,
      type: textType(text, previous, next),
      level: "text",
      beforeFirstScene: false,
    });
  }

  const unreadable = blocks
    .filter((b) => b.type === "SLUGLINE" && b.autoNumber?.kind === "unreadable")
    .map((b) => b.paragraphIndex);
  const notices: TypingNotice[] = unreadable.length
    ? [{ code: "slugline_autonumber_unreadable", paragraphIndexes: unreadable }]
    : [];

  return { blocks, conflicts, dropped, indentProfile, notices };
}

function addConflict(
  conflicts: TypeConflict[],
  paragraph: DocxParagraph,
  text: string,
  assigned: ImportBlockType,
  level: Exclude<TypeLevel, "text">,
) {
  const base = { paragraphIndex: paragraph.index, text: paragraph.text, assigned, level };
  if (assigned !== "SLUGLINE" && isSluglineText(text)) {
    conflicts.push({ ...base, suggested: "SLUGLINE", reason: "looks_like_slugline" });
    return;
  }
  if (assigned === "CHARACTER" && !isNameLike(text)) {
    conflicts.push({ ...base, suggested: "ACTION", reason: "character_looks_like_prose" });
  }
}
