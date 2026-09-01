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

function isPrismaDecimal(value: unknown): value is { toString(): string } {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    "toFixed" in value &&
    "toString" in value
  );
}

/** Deep-clone data for RSC → Client props (Decimal → number). */
export function serializeForClient<T>(data: T): T {
  if (isPrismaDecimal(data)) {
    return Number(data) as T;
  }
  if (Array.isArray(data)) {
    return data.map((item) => serializeForClient(item)) as T;
  }
  if (data instanceof Date) {
    return data;
  }
  if (data != null && typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      out[key] = serializeForClient(value);
    }
    return out as T;
  }
  return data;
}
