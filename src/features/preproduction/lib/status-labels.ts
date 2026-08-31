import type { CastingCandidateStatus, ScoutCandidateStatus } from "@prisma/client";

export const castingStatusLabels: Record<CastingCandidateStatus, string> = {
  CONSIDERING: "Рассматривается",
  APPLICATION_SENT: "Заявка отправлена",
  CASTING: "Кастинг",
  UNDER_REVIEW: "На рассмотрении",
  APPROVED: "Утверждён",
  REJECTED: "Отказ",
};

export const scoutStatusLabels: Record<ScoutCandidateStatus, string> = {
  CONSIDERING: "Рассматривается",
  NEGOTIATION: "Согласование",
  APPROVED: "Утверждена",
  REJECTED: "Отказ",
};

export const castingStatusOptions = Object.entries(castingStatusLabels).map(
  ([value, label]) => ({ value: value as CastingCandidateStatus, label }),
);

export const scoutStatusOptions = Object.entries(scoutStatusLabels).map(
  ([value, label]) => ({ value: value as ScoutCandidateStatus, label }),
);
