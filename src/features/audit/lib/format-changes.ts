export type FieldChange = {
  field: string;
  before: unknown;
  after: unknown;
};

/** Normalize `changes` JSON into rows for display. */
export function parseAuditChanges(
  changes: unknown,
): FieldChange[] | null {
  if (changes == null) return null;
  if (typeof changes !== "object" || Array.isArray(changes)) return null;

  const obj = changes as Record<string, unknown>;

  if (obj.fields && typeof obj.fields === "object" && !Array.isArray(obj.fields)) {
    const fields = obj.fields as Record<string, { from?: unknown; to?: unknown }>;
    return Object.entries(fields).map(([field, diff]) => ({
      field,
      before: diff?.from ?? null,
      after: diff?.to ?? null,
    }));
  }

  const entries = Object.entries(obj);
  if (entries.length === 0) return null;

  return entries.map(([field, value]) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      ("from" in value || "to" in value)
    ) {
      const diff = value as { from?: unknown; to?: unknown };
      return { field, before: diff.from ?? null, after: diff.to ?? null };
    }
    return { field, before: null, after: value };
  });
}

export function formatAuditValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
