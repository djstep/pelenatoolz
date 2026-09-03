export type AuditionKind = "solo" | "pair" | "ensemble";

export function auditionKindFromCount(count: number): AuditionKind {
  if (count <= 1) return "solo";
  if (count === 2) return "pair";
  return "ensemble";
}

export const auditionKindLabels: Record<AuditionKind, string> = {
  solo: "Сольная",
  pair: "Парная",
  ensemble: "Ансамблевая",
};

export type AuditionFilters = {
  q?: string;
  personId?: string;
  characterId?: string;
  sceneId?: string;
  dateFrom?: string;
  dateTo?: string;
  kind?: AuditionKind | "ALL";
  selfTape?: "yes" | "no" | "ALL";
};

export type AuditionActorInput = {
  personId: string;
  characterId?: string | null;
};
