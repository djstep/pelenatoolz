import type { LocationKind } from "@prisma/client";
import { locationKindLabels } from "@/shared/i18n/domain-labels";

export function formatLocationTitle(
  name: string,
  sublocation?: string | null,
) {
  return sublocation?.trim() ? `${name}.${sublocation}` : name;
}

export function formatLocationKind(kind: LocationKind | null | undefined) {
  return kind ? locationKindLabels[kind] : "—";
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}
