/** «65 200 ₽» */
export function formatRub(n: number) {
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

/** «+1 500 ₽» / «−1 500 ₽» / «0 ₽» */
export function formatRubDelta(n: number) {
  if (Math.abs(n) < 0.005) return "0 ₽";
  return `${n > 0 ? "+" : "−"}${formatRub(Math.abs(n))}`;
}
