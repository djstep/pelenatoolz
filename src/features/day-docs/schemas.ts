import { ActorTransportMode, CallSheetUnit, TimeSlotType } from "@prisma/client";
import { z } from "zod";

const timeString = z.string().trim().max(10).optional().or(z.literal(""));

export const updateCallSheetHeaderSchema = z.object({
  shiftNumber: z.coerce.number().int().min(1).max(99).optional().nullable(),
  callTime: timeString,
  wrapTime: timeString,
  shiftStartTime: timeString,
  rehearsalTime: timeString,
  motorOnTime: timeString,
  motorOffTime: timeString,
  crewMeetAddress: z.string().trim().max(500).optional(),
  crewMeetTime: timeString,
  weatherNote: z.string().trim().max(500).optional(),
  weatherPrecip: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  comment: z.string().trim().max(2000).optional(),
});

export const departmentCallRowSchema = z.object({
  roleLabel: z.string().trim().min(1).max(120),
  personName: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  callTime: timeString,
});

export const timeSlotRowSchema = z.object({
  startTime: z.string().trim().min(1).max(10),
  endTime: timeString,
  slotType: z.enum(TimeSlotType),
  sceneId: z.string().cuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional(),
  /** Юнит строки. Не передан (старые строки, старый редактор) — основной. */
  unit: z.enum(CallSheetUnit).default(CallSheetUnit.MAIN),
  /** «Продолжение сцены» — только у строки со сценой (проверка — plan-rules.ts). */
  isContinuation: z.boolean().default(false),
  /** Свой текст строки вместо названия типа. Пусто — название типа. */
  customLabel: z
    .string()
    .trim()
    .max(200, "Свой текст строки плана — до 200 знаков")
    .nullable()
    .optional(),
});

export const actorCallRowSchema = z.object({
  actorId: z.string().cuid(),
  pickupTime: timeString,
  arrivalTime: timeString,
  makeupTime: timeString,
  costumeTime: timeString,
  readyTime: timeString,
  wrapTime: timeString,
  /** Транспорт актёра: машина / сам / свой текст. Пусто — не указан. */
  transportMode: z.enum(ActorTransportMode).nullable().optional().or(z.literal("")),
  transportText: z.string().trim().max(200).optional(),
  /** Подача машины — сохраняется только при транспорте «машина». */
  carPickupTime: timeString,
}).refine(
  (row) => row.transportMode !== ActorTransportMode.CUSTOM || Boolean(row.transportText),
  { message: "Транспорт актёра: впишите свой текст" },
);

export const resourceCallRowSchema = z.object({
  category: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  arrivalTime: timeString,
  costumeTime: timeString,
  makeupTime: timeString,
  readyTime: timeString,
  wrapTime: timeString,
});

export const saveDepartmentCallsSchema = z.object({
  rows: z.array(departmentCallRowSchema),
});

export const saveTimeSlotsSchema = z.object({
  rows: z.array(timeSlotRowSchema).max(500, "Слишком много строк плана"),
});

export const saveActorCallsSchema = z.object({
  rows: z.array(actorCallRowSchema),
});

export const saveResourceCallsSchema = z.object({
  rows: z.array(resourceCallRowSchema),
});

export const resourceUsageRowSchema = z.object({
  itemId: z.string().cuid(),
  arrivalTime: timeString,
  readyTime: timeString,
  wrapTime: timeString,
});

export const saveResourceUsagesSchema = z.object({
  rows: z.array(resourceUsageRowSchema),
});
