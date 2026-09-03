import type {
  ProductionSceneFactStatus,
  ProductionWorkKind,
  ShootDayStatus,
  ShootDayType,
} from "@prisma/client";
import {
  formatMinutesHhMm,
  formatSecondsMmSs,
} from "@/shared/i18n/domain-labels";
import { minutesBetweenTimes } from "@/features/day-docs/lib/time-utils";

/** Client-safe helpers & types for production reports (no Prisma client). */

export function formatFactDuration(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  if (!start?.trim() || !end?.trim()) return null;
  const mins = minutesBetweenTimes(start.trim(), end.trim());
  if (mins <= 0) return null;
  return formatMinutesHhMm(mins);
}

export function factSecondsLabel(seconds: number | null | undefined) {
  return seconds != null && seconds > 0 ? formatSecondsMmSs(seconds) : "—";
}

export type ProductionReportMontageRow = {
  id: string;
  sceneFactId: string;
  scenePart: string | null;
  frame: string | null;
  take: string | null;
  takeStatus: string | null;
  takeRuntime: string | null;
  cameraFiles: unknown;
  shotSize: string | null;
  sortOrder: number;
};

export type ProductionReportSceneFact = {
  id: string;
  reportId: string;
  sceneId: string;
  status: ProductionSceneFactStatus;
  factSeconds: number | null;
  prepStart: string | null;
  prepEnd: string | null;
  rehearsalStart: string | null;
  rehearsalEnd: string | null;
  motorStart: string | null;
  motorEnd: string | null;
  notes: string | null;
  sortOrder: number;
  returnedToPool: boolean;
  sceneLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
  scene: {
    id: string;
    episodeNumber: number;
    number: string;
    postfix: string;
    title: string | null;
    planSeconds: number | null;
    factSeconds: number | null;
    pageCount: number | null;
    status: string;
    summary: string | null;
  };
  montageRows: ProductionReportMontageRow[];
};

export type ProductionReportWorkExtra = {
  id: string;
  workRowId: string;
  amount: number;
  description: string | null;
};

export type ProductionReportWorkRow = {
  id: string;
  reportId: string;
  kind: ProductionWorkKind;
  actorId: string | null;
  resourceItemId: string | null;
  locationId: string | null;
  sourceKey: string;
  displayName: string;
  categoryLabel: string | null;
  factStart: string | null;
  factEnd: string | null;
  lunchSkipped: boolean;
  workedMin: number | null;
  factOvertimeMin: number | null;
  payableOvertimeMin: number | null;
  shiftHoursMin: number | null;
  unpaidOvertimeMin: number | null;
  shiftRate: number | null;
  forceMajeurePct: number | null;
  shiftPay: number | null;
  overtimePay: number | null;
  extrasPay: number | null;
  totalPay: number | null;
  sortOrder: number;
  extras: ProductionReportWorkExtra[];
};

export type ProductionReportBundle = {
  day: {
    id: string;
    dayNumber: number;
    date: Date;
    dayType: ShootDayType;
    status: ShootDayStatus;
    isNightShift: boolean;
    callTime: string | null;
    wrapTime: string | null;
    shiftStartTime: string | null;
  };
  project: {
    id: string;
    name: string;
    fullName: string | null;
    city: string | null;
    cameraCount: number | null;
  };
  cameraCount: number;
  report: {
    id: string;
    shootDayId: string;
    factShiftStart: string | null;
    factShiftEnd: string | null;
    lunchStart: string | null;
    lunchEnd: string | null;
    breakNotes: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    sceneFacts: ProductionReportSceneFact[];
    workRows: ProductionReportWorkRow[];
  };
  factDuration: string | null;
};
