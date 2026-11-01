/**
 * Ставка за км спецтранспорта — деньги (в отчёте смены правит `finance:write`).
 * Строки спецтранспорта при сохранении пересоздаются, поэтому без фин. правки ставка
 * берётся из прежней строки с тем же названием, а присланная из браузера отбрасывается.
 * Новая строка без пары — без ставки.
 */
export function resolveTransportKmRates(
  rows: { name: string; kmRate?: number | null }[],
  existing: { name: string; kmRate: number | null }[],
  canWriteFinance: boolean,
): (number | null)[] {
  if (canWriteFinance) return rows.map((row) => row.kmRate ?? null);

  const unused = [...existing];
  return rows.map((row) => {
    const key = row.name.trim().toLocaleLowerCase("ru");
    const index = unused.findIndex((e) => e.name.trim().toLocaleLowerCase("ru") === key);
    if (index < 0) return null;
    const [match] = unused.splice(index, 1);
    return match.kmRate;
  });
}
