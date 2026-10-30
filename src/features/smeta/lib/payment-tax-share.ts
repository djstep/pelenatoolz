/**
 * Доля платежа с налогом по строкам разбивки.
 *
 * Разбивка платежа хранится без налога (сумма строк = `CashPayment.amount`), налог у платежа
 * один на весь платёж. Налог делится пропорционально строкам; копейки, оставшиеся после
 * округления, уходят в наибольшую строку — сумма долей налога точно равна налогу платежа.
 */
export function shareTaxOverBreakdown<T extends { amount: number }>(
  payment: { amount: number; amountWithTax: number },
  rows: readonly T[],
): { row: T; withTax: number }[] {
  const kop = (n: number) => Math.round(n * 100);
  const base = rows.map((r) => kop(r.amount));
  const baseSum = base.reduce((s, n) => s + n, 0);
  const tax = kop(payment.amountWithTax) - kop(payment.amount);

  const shares = base.map((b) => (baseSum === 0 ? 0 : Math.round((tax * b) / baseSum)));
  if (rows.length > 0) {
    let largest = 0;
    for (let i = 1; i < base.length; i++) if (base[i] > base[largest]) largest = i;
    shares[largest] += tax - shares.reduce((s, n) => s + n, 0);
  }
  return rows.map((row, i) => ({ row, withTax: (base[i] + shares[i]) / 100 }));
}
