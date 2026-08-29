import {
  ProjectStatus,
  ProjectType,
  TimingMode,
} from "@prisma/client";
import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(200),
  fullName: z.string().trim().max(300).optional(),
  description: z.string().trim().max(5000).optional(),
  type: z.enum(ProjectType),
  status: z.enum(ProjectStatus).optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .regex(/^[A-Z]{3}$/)
    .optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  city: z.string().trim().max(120).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  episodeCount: z.coerce.number().int().min(1).max(999).optional(),
  episodeRuntimeMin: z.coerce.number().int().min(1).max(600).optional(),
  shootingDaysCount: z.coerce.number().int().min(1).max(999).optional(),
  cameraUnits: z.coerce.number().int().min(1).max(10).optional(),
  cameraCount: z.coerce.number().int().min(1).max(10).optional(),
  timingMode: z.enum(TimingMode).optional(),
  pageToMinuteRatio: z.coerce.number().min(0.1).max(10).optional(),
  plannedDailyOutputMin: z.coerce.number().min(0).max(1440).optional(),
  shootOnFilm: z
    .union([z.literal("on"), z.literal("true"), z.boolean()])
    .optional()
    .transform((v) => v === "on" || v === "true" || v === true),
  filmType: z.string().trim().max(100).optional(),
  filmCoefficient: z.coerce.number().min(0).max(100).optional(),
  calcCalendarDays: z
    .union([z.literal("on"), z.literal("true"), z.boolean()])
    .optional()
    .transform((v) => v === "on" || v === "true" || v === true),
});

export const updateProjectSchema = createProjectSchema.partial();

export const createInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : value))
    .pipe(z.email().max(255).optional()),
  roleId: z.string().cuid(),
  expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
});

export const updateMemberRoleSchema = z.object({
  membershipId: z.string().cuid(),
  roleId: z.string().cuid(),
});

export const deleteProjectSchema = z.object({
  confirmName: z.string().trim().min(1),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type DeleteProjectInput = z.infer<typeof deleteProjectSchema>;
