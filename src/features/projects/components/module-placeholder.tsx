import { Card } from "@/shared/ui/card";

export function ModulePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <p className="mt-3 text-sm text-[var(--muted-fg)]">{description}</p>
      <p className="mt-4 inline-flex glass-badge rounded-lg px-3 py-1 text-xs font-medium uppercase tracking-wide">
        В разработке
      </p>
    </Card>
  );
}
