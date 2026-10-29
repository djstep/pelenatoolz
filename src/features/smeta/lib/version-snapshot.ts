/**
 * Снимок основного листа для утверждённой версии: формулы заменены их значениями.
 * В версии нет других листов книги, поэтому ссылки вроде `=Лист1!B2` сломались бы —
 * в снимке остаются только вычисленные числа и тексты.
 */
export function freezeSheetFormulas(sheet: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(sheet)) as Record<string, unknown>;
  const cellData = copy.cellData;
  if (!cellData || typeof cellData !== "object") return copy;
  for (const row of Object.values(cellData as Record<string, unknown>)) {
    if (!row || typeof row !== "object") continue;
    for (const cell of Object.values(row as Record<string, unknown>)) {
      if (!cell || typeof cell !== "object") continue;
      const c = cell as Record<string, unknown>;
      delete c.f;
      delete c.si;
    }
  }
  return copy;
}
