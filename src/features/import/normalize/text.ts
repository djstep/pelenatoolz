/** Символы: пробелы, тире, латинские буквы-двойники, ключ сравнения. Чистые функции. */

const SPACE_RE = /[  -   　\t]/g;
const INVISIBLE_RE = /[­​-‍⁠﻿]/g;

/** Неразрывные, двойные и хвостовые пробелы. Переносы строк внутри абзаца сохраняются. */
export function cleanSpaces(text: string) {
  return text
    .replace(INVISIBLE_RE, "")
    .replace(SPACE_RE, " ")
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .trim();
}

/** Разные тире → «—». Дефис внутри слова не трогаем, отдельно стоящий « - » — тире. */
export function normalizeDashes(text: string) {
  return text
    .replace(/‑/g, "-")
    .replace(/[‒–—―−]/g, "—")
    .replace(/(^|\s)-{1,2}(?=\s|$)/gm, "$1—");
}

export function cleanText(text: string) {
  return normalizeDashes(cleanSpaces(text));
}

/** Ключ сравнения: верхний регистр, Ё = Е, один пробел. */
export function compareKey(text: string) {
  return cleanSpaces(text).toUpperCase().replace(/Ё/g, "Е");
}

const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У",
  a: "а",
  c: "с",
  e: "е",
  o: "о",
  p: "р",
  x: "х",
  y: "у",
};

const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const LATIN_RE = /\p{Script=Latin}/gu;

function latinLetters(word: string) {
  return word.match(LATIN_RE) ?? [];
}

/** Кириллическое слово с латинскими двойниками внутри: «КВАPТИРА». */
export function isMixedWord(word: string) {
  const latin = latinLetters(word);
  return (
    latin.length > 0 &&
    CYRILLIC_RE.test(word) &&
    latin.every((ch) => ch in LATIN_TO_CYRILLIC)
  );
}

/** Слово целиком из латинских двойников: «MAMA». Может быть настоящим названием. */
export function isLatinLookalikeWord(word: string) {
  const latin = latinLetters(word);
  return (
    latin.length > 0 &&
    latin.length === word.length &&
    latin.every((ch) => ch in LATIN_TO_CYRILLIC)
  );
}

export function toCyrillic(word: string) {
  return word.replace(LATIN_RE, (ch) => LATIN_TO_CYRILLIC[ch] ?? ch);
}

/** Буквы вставных сцен по порядку: латинская буква в номере → кириллическая той же позиции. */
const SCENE_LETTERS = "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ";
const LATIN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** «a», «A» → «А»; кириллица — в верхний регистр. */
export function sceneLetter(letter: string) {
  const upper = letter.toUpperCase();
  const latin = LATIN_ALPHABET.indexOf(upper);
  if (latin >= 0) return SCENE_LETTERS[latin] ?? upper;
  return upper === "Ё" ? "Е" : upper;
}

/** Следующий свободный номер-вставка после `base`: 11 → 11А, 11А → 11Б. */
export function nextSceneNumber(base: string, used: ReadonlySet<string>) {
  const match = compareKey(base).match(/^(\d+)(\p{L}?)$/u);
  if (!match) return null;
  const start = match[2] ? SCENE_LETTERS.indexOf(match[2]) + 1 : 0;
  for (let i = start; i < SCENE_LETTERS.length; i++) {
    const candidate = `${match[1]}${SCENE_LETTERS[i]}`;
    if (!used.has(candidate)) return candidate;
  }
  return null;
}
