import { cleanSpaces } from "@/features/import/normalize/text";

export type ParsedCue = {
  /** Имя без скобок, в верхнем регистре. Пусто — «(ДАЛЬШЕ)» и подобное. */
  name: string;
  /** Расширения из скобок: «ЗК», «ПРОД.», «V.O.». Сохраняются у реплики. */
  extensions: string[];
};

/**
 * Имя перед репликой. Любые скобки — не часть имени, в том числе вплотную: «ВИКТОРИЯ(ЗК)».
 * Число в скобках («АННА (5)») — возраст: не имя и не расширение, не сохраняется.
 */
export function parseCue(text: string): ParsedCue {
  const extensions: string[] = [];
  const name = text.replace(/\(([^()]*)\)/g, (_, inner: string) => {
    const value = cleanSpaces(inner).toUpperCase();
    if (value && !/^\d+$/.test(value)) extensions.push(value);
    return " ";
  });
  return { name: cleanSpaces(name).toUpperCase(), extensions };
}

export function formatCue(cue: ParsedCue) {
  return [cue.name, ...cue.extensions.map((ext) => `(${ext})`)].join(" ");
}

/** Цифра вплотную к имени: «СТАЖЕР1» — вопрос «СТАЖЕР 1» или опечатка. */
export function hasTrailingDigit(name: string) {
  return /\p{L}\d+$/u.test(name);
}

export function withSpacedDigit(name: string) {
  return name.replace(/(\p{L})(\d+)$/u, "$1 $2");
}

export function withoutTrailingDigit(name: string) {
  return name.replace(/\d+$/, "").trim();
}

/** Строка «Персонажи»: «Мама, АННА,софия» → имена в верхнем регистре. */
export function parseCastLine(text: string): { prefix: string | null; names: string[] } {
  const prefix = text.match(/^\s*персонажи\s*:\s*/iu)?.[0] ?? null;
  const names = text
    .slice(prefix?.length ?? 0)
    .split(/[,;]/)
    .map((part) => cleanSpaces(part.replace(/\([^()]*\)/g, " ")).toUpperCase())
    .filter(Boolean);
  return { prefix: prefix ? cleanSpaces(prefix).replace(/\s*:$/, ":") : null, names };
}

export function formatCastLine(prefix: string | null, names: string[]) {
  return `${prefix ? `${prefix} ` : ""}${names.join(", ")}`;
}
