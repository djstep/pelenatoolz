import type { Prisma } from "@prisma/client";

const FIELDS = [
  ["title", "Название"],
  ["subtitle", "Подзаголовок"],
  ["author", "Автор"],
  ["version", "Версия"],
  ["date", "Дата"],
  ["city", "Город"],
] as const;

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function lines(value: unknown) {
  return Array.isArray(value) ? value.flatMap((line) => (text(line) ? [String(line)] : [])) : [];
}

/** Титульная страница версии из импорта (`ScriptVersion.titlePage`). Только показ. */
export function ScriptTitlePage({ value }: { value: Prisma.JsonValue | null }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const page = value as Record<string, unknown>;
  const fields = FIELDS.flatMap(([key, label]) => {
    const v = text(page[key]);
    return v ? [{ key, label, value: v }] : [];
  });
  const other = [...lines(page.other), ...lines(page.contacts)];
  if (fields.length === 0 && other.length === 0) return null;

  return (
    <details className="glass-card mb-4 p-4 text-sm">
      <summary className="cursor-pointer font-medium">
        Титульная страница{fields[0]?.key === "title" ? `: ${fields[0].value}` : ""}
      </summary>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <div key={f.key}>
            <dt className="text-xs text-[var(--muted-fg)]">{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {other.length > 0 ? (
        <p className="mt-3 text-xs text-[var(--muted-fg)]">{other.join(" · ")}</p>
      ) : null}
    </details>
  );
}
