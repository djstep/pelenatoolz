export type PluralForms = [string, string, string];

/** Форма слова для числа: plural(3, ["договор", "договора", "договоров"]) → «договора». */
export function plural(n: number, forms: PluralForms): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** «3 договора» */
export function countOf(n: number, forms: PluralForms): string {
  return `${n} ${plural(n, forms)}`;
}

/** «a», «a и b», «a, b и c» */
export function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} и ${parts[parts.length - 1]}`;
}

/** Части с нулевым числом пропускаются: listCounts([[3, договор], [0, акт]]) → «3 договора». */
export function listCounts(items: Array<[number, PluralForms]>): string {
  return joinAnd(items.filter(([n]) => n > 0).map(([n, forms]) => countOf(n, forms)));
}

/** Строки «что удалится или отвяжется» для окна подтверждения: «Текст: N», нули пропускаются. */
export function impactLines(items: Array<[number, string]>): string[] {
  return items.filter(([n]) => n > 0).map(([n, text]) => `${text}: ${n}`);
}
