import { TimeSlotType } from "@prisma/client";
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

export const transportRowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  callTime: timeString,
  notes: z.string().trim().max(500).optional(),
});

export const timeSlotRowSchema = z.object({
  startTime: z.string().trim().min(1).max(10),
  endTime: timeString,
  slotType: z.enum(TimeSlotType),
  sceneId: z.string().cuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional(),
});

export const actorCallRowSchema = z.object({
  actorId: z.string().cuid(),
  pickupTime: timeString,
  arrivalTime: timeString,
  makeupTime: timeString,
  costumeTime: timeString,
  readyTime: timeString,
  wrapTime: timeString,
});

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

export const saveTransportsSchema = z.object({
  rows: z.array(transportRowSchema),
});

export const saveTimeSlotsSchema = z.object({
  rows: z.array(timeSlotRowSchema),
});

export const saveActorCallsSchema = z.object({
  rows: z.array(actorCallRowSchema),
});

export const saveResourceCallsSchema = z.object({
  rows: z.array(resourceCallRowSchema),
});
