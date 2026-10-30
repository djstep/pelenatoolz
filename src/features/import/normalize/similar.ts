/** Похожие имена персонажей и объектов: только предложения, сами имена не склеиваются. */

export type SimilarKind = "character" | "location";
export type SimilarReason = "prefix" | "distance" | "word";

/** Расстояние редактирования считается для имён от 5 букв, похожими — до 2 правок. */
const MIN_DISTANCE_LENGTH = 5;
const MAX_DISTANCE = 2;
/** Правило слов (только локации): слова от 3 букв, окончание до 2 букв (ДОМ / ДОМА). */
const MIN_WORD_LENGTH = 3;
const MAX_ENDING = 2;

/** Расстояние Левенштейна. Больше `limit` не уточняет — возвращает `limit + 1`. */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const value = Math.min(
        previous[j]! + 1,
        row[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length]!;
}

/** «СТАЖЕР1», «СТАЖЕР 1», «СТАЖЕР» — одно и то же без числа: такие пары не предлагаются. */
function withoutNumber(key: string) {
  return key.replace(/\s*\d+$/u, "");
}

function words(key: string) {
  return key.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= MIN_WORD_LENGTH);
}

function sameWord(a: string, b: string) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.startsWith(short) && long.length - short.length <= MAX_ENDING;
}

/**
 * Почему два ключа похожи (ключи уже после `compareKey`): одно — начало другого до пробела
 * или дефиса; расстояние ≤ 2 при длине ≥ 5; у локаций — общее слово с окончанием до 2 букв.
 */
export function similarReason(a: string, b: string, kind: SimilarKind): SimilarReason | null {
  if (a === b || withoutNumber(a) === withoutNumber(b)) return null;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.startsWith(short) && /^[\s-]/u.test(long.slice(short.length))) return "prefix";
  if (short.length >= MIN_DISTANCE_LENGTH && editDistance(a, b, MAX_DISTANCE) <= MAX_DISTANCE) {
    return "distance";
  }
  if (kind === "location") {
    const other = words(b);
    if (words(a).some((word) => other.some((x) => sameWord(word, x)))) return "word";
  }
  return null;
}

/** Ключ пары для кода вопроса: два ключа по порядку, через «|». */
export function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function pairMembers(key: string): [string, string] | null {
  const parts = key.split("|");
  return parts.length === 2 ? [parts[0]!, parts[1]!] : null;
}
