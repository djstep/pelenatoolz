/** Prisma Decimal → number for RSC → Client Component props. */
export function dec(
  value: { toString(): string } | number | null | undefined,
): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  return Number(value);
}

export function mapDecFields<T extends Record<string, unknown>>(
  row: T,
  keys: (keyof T)[],
): T {
  const next = { ...row };
  for (const key of keys) {
    const val = row[key];
    if (val != null && typeof val === "object" && "toString" in val) {
      (next as Record<string, unknown>)[key as string] = Number(val);
    }
  }
  return next;
}
