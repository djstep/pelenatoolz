import type { ActorRoleType, ContractorType, Gender } from "@prisma/client";

/** Snapshot copied to Character on candidate approval — independently editable after. */
export type CharacterCastSnapshot = {
  photoUrl?: string | null;
  lastName: string;
  firstName?: string | null;
  middleName?: string | null;
  phone?: string | null;
  email?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  physicalParams?: Record<string, string>;
  skills?: string[];
  proposedRate?: number | null;
  proposedTerms?: string | null;
  shiftRate?: number | null;
  shiftHoursMin?: number | null;
  unpaidOvertimeMin?: number | null;
  forceMajeurePct?: number | null;
  riderNotes?: string | null;
  roleType?: ActorRoleType;
  contractorType?: ContractorType;
  gender?: Gender | null;
  approvedAt?: string;
};

export type ScoutMediaItem = {
  url: string;
  caption?: string | null;
};

/** Snapshot copied to Location on scout approval. */
export type LocationScoutSnapshot = {
  title: string;
  address?: string | null;
  cost?: number | null;
  contactName?: string | null;
  contactPhone?: string | null;
  photos?: ScoutMediaItem[];
  videos?: ScoutMediaItem[];
  notes?: string | null;
  approvedAt?: string;
};

export const STANDARD_PHYSICAL_PARAM_KEYS = [
  "height",
  "weight",
  "eyeColor",
  "hairColor",
  "clothingSize",
  "shoeSize",
] as const;

export const PHYSICAL_PARAM_LABELS: Record<string, string> = {
  height: "Рост (см)",
  weight: "Вес (кг)",
  eyeColor: "Цвет глаз",
  hairColor: "Цвет волос",
  clothingSize: "Размер одежды",
  shoeSize: "Размер обуви",
};

export function fullNameFromParts(parts: {
  lastName: string;
  firstName?: string | null;
  middleName?: string | null;
}) {
  return [parts.lastName, parts.firstName, parts.middleName]
    .filter(Boolean)
    .join(" ");
}

export function parseCastSnapshot(raw: unknown): CharacterCastSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as CharacterCastSnapshot;
  if (!o.lastName) return null;
  return o;
}

export function parseScoutSnapshot(raw: unknown): LocationScoutSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as LocationScoutSnapshot;
  if (!o.title) return null;
  return o;
}
