/** Parse overtime rate rows from financial-terms form fields. */
export function parseOvertimeFormRows(
  formData: FormData,
  shiftRate: number,
  taxPct: number,
) {
  const rows: Array<{
    hourNumber: number;
    percentRate: number | null;
    amount: number | null;
    taxPercent: number | null;
    taxAmount: number | null;
    totalWithTax: number | null;
  }> = [];

  function blank(value: FormDataEntryValue | null) {
    return value == null || String(value).trim() === "";
  }

  for (let i = 1; i <= 24; i++) {
    const pctRaw = formData.get(`ot_pct_${i}`);
    const amountRaw = formData.get(`ot_amount_${i}`);
    if (blank(pctRaw) && blank(amountRaw)) continue;
    const percentRate = blank(pctRaw) ? null : Number(pctRaw);
    let amount = blank(amountRaw) ? null : Number(amountRaw);
    if (amount == null && percentRate != null && shiftRate > 0) {
      amount = (shiftRate * percentRate) / 100;
    }
    if (percentRate == null && amount == null) continue;
    if (Number.isNaN(percentRate ?? 0) || Number.isNaN(amount ?? 0)) continue;

    const rowTaxRaw = formData.get(`ot_tax_${i}`);
    const rowTaxPct = blank(rowTaxRaw) ? taxPct : Number(rowTaxRaw);
    const taxAmount =
      amount != null ? (amount * (rowTaxPct || 0)) / 100 : null;
    const totalWithTax =
      amount != null ? amount + (taxAmount ?? 0) : null;
    rows.push({
      hourNumber: i,
      percentRate,
      amount,
      taxPercent: rowTaxPct,
      taxAmount,
      totalWithTax,
    });
  }
  return rows;
}
