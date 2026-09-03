import type {
  ActorRoleType,
  CastingCandidateStatus,
  TimeSlotType,
} from "@prisma/client";
import type { AuditionKind } from "@/features/auditions/lib/types";

/** Default hourly slots for the planner UI (client-safe). */
export const SCHEDULE_TIME_SLOTS = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
] as const;

export type SchedulePanelFilters = {
  q?: string;
  characterId?: string;
  roleType?: ActorRoleType | "ALL";
  ratingMin?: number;
  callFilter?: "ALL" | "never" | "called";
};

export type ScheduleCandidateCard = {
  id: string;
  rating: number | null;
  status: CastingCandidateStatus;
  person: {
    id: string;
    photoUrl: string | null;
    lastName: string;
    firstName: string | null;
    middleName: string | null;
    label: string;
  };
  character: {
    id: string;
    name: string;
    roleType: ActorRoleType | null;
  };
  hasTape: boolean;
  wasCalled: boolean;
  nextCall: {
    dateKey: string;
    time: string;
    scheduleId: string;
  } | null;
};

export type AuditionScheduleCandidateView = {
  linkId: string;
  castingCandidateId: string;
  rating: number | null;
  person: {
    id: string;
    photoUrl: string | null;
    lastName: string;
    firstName: string | null;
    middleName: string | null;
    label: string;
  };
  character: {
    id: string;
    name: string;
    roleType: ActorRoleType | null;
  };
};

export type AuditionScheduleRow = {
  id: string;
  projectId: string;
  date: Date | string;
  time: string;
  comment: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  dateKey: string;
  kind: AuditionKind;
  candidates: AuditionScheduleCandidateView[];
};

export type AuditionScheduleBreakRow = {
  id: string;
  projectId: string;
  date: Date | string;
  time: string;
  duration: string;
  slotType: TimeSlotType;
  label: string;
  notes: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  dateKey: string;
};
