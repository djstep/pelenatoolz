/** Parse additional payment rows from financial-terms form fields. */
export function parseExtraPaymentFormRows(
  formData: FormData,
  defaultTaxPct: number,
) {
  const rows: Array<{
    paymentDate: Date | null;
    amount: number;
    taxPercent: number | null;
    taxAmount: number | null;
    totalWithTax: number | null;
    description: string | null;
  }> = [];

  function blank(value: FormDataEntryValue | null) {
    return value == null || String(value).trim() === "";
  }

  for (let i = 0; i < 50; i++) {
    const amountRaw = formData.get(`ep_amount_${i}`);
    const dateRaw = String(formData.get(`ep_date_${i}`) ?? "").trim();
    const descRaw = String(formData.get(`ep_desc_${i}`) ?? "").trim();
    if (blank(amountRaw) && !dateRaw && !descRaw) continue;
    const amount = blank(amountRaw) ? 0 : Number(amountRaw);
    if (Number.isNaN(amount)) continue;
    if (amount === 0 && !dateRaw && !descRaw) continue;

    const rowTaxRaw = formData.get(`ep_tax_${i}`);
    const rowTax = blank(rowTaxRaw) ? defaultTaxPct : Number(rowTaxRaw);
    const taxAmountRaw = formData.get(`ep_tax_amount_${i}`);
    const totalRaw = formData.get(`ep_total_${i}`);

    let taxAmount: number;
    let totalWithTax: number;
    if (!blank(totalRaw) && !blank(taxAmountRaw)) {
      totalWithTax = Number(totalRaw);
      taxAmount = Number(taxAmountRaw);
      if (Number.isNaN(totalWithTax) || Number.isNaN(taxAmount)) continue;
    } else {
      taxAmount = (amount * (rowTax || 0)) / 100;
      totalWithTax = amount + taxAmount;
    }

    rows.push({
      paymentDate: dateRaw ? new Date(dateRaw) : null,
      amount,
      taxPercent: rowTax,
      taxAmount,
      totalWithTax,
      description: descRaw || null,
    });
  }
  return rows;
}

export function sumExtrasPay(
  extras: Array<{ amount: unknown; totalWithTax?: unknown }>,
): number {
  return extras.reduce((sum, e) => {
    const total =
      e.totalWithTax != null && String(e.totalWithTax) !== ""
        ? Number(e.totalWithTax)
        : Number(e.amount);
    return sum + (Number.isFinite(total) ? total : 0);
  }, 0);
}
