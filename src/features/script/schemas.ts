import { SceneKind } from "@prisma/client";
import {
  DayNight,
  ElementType,
  IntExt,
  SceneResourceCategory,
  SceneStatus,
  ShootDayStatus,
  ShootDayType,
} from "@prisma/client";
import { z } from "zod";
import { parseMmSs } from "@/shared/i18n/domain-labels";

const mmSs = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? parseMmSs(v) : undefined));

export const createSceneSchema = z.object({
  episodeNumber: z.coerce.number().int().min(0).max(999).optional(),
  number: z.string().trim().min(1).max(20),
  postfix: z.string().trim().max(10).optional(),
  title: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(5000).optional(),
  description: z.string().trim().max(5000).optional(),
  scriptContent: z.string().trim().max(100000).optional(),
  scriptDay: z.coerce.number().int().min(0).max(9999).optional(),
  objectType: z.string().trim().max(100).optional(),
  sceneKind: z.enum(SceneKind).optional(),
  shootingUnit: z.string().trim().max(100).optional(),
  montageMap: z.string().trim().max(500).optional(),
  pageCount: z.coerce.number().min(0).max(999).optional(),
  planSeconds: mmSs,
  factSeconds: mmSs,
  preEditSeconds: mmSs,
  editSeconds: mmSs,
  filmFootagePlan: z.coerce.number().min(0).optional(),
  filmFootageFact: z.coerce.number().min(0).optional(),
  intExt: z.enum(IntExt).optional(),
  dayNight: z.enum(DayNight).optional(),
  status: z.enum(SceneStatus).optional(),
  locationId: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.string().cuid().optional(),
  ),
  characterIds: z.array(z.string().cuid()).optional(),
  elementIds: z.array(z.string().cuid()).optional(),
  createAnother: z
    .union([z.literal("on"), z.boolean()])
    .optional()
    .transform((v) => v === "on" || v === true),
});

export const sceneResourceRowSchema = z.object({
  category: z.enum(SceneResourceCategory),
  name: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().int().min(1).max(9999),
  unitPrice: z.coerce.number().min(0),
});

export const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  objectType: z.string().trim().max(100).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const createCharacterSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});

export const createElementSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(ElementType).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const createShootDaySchema = z
  .object({
    dateFrom: z.string().min(1),
    dateTo: z.string().optional(),
    dayNumber: z.coerce.number().int().min(1).max(9999),
    unit: z.string().trim().max(50).optional(),
    callTime: z.string().trim().max(10).optional(),
    wrapTime: z.string().trim().max(10).optional(),
    notes: z.string().trim().max(2000).optional(),
    comment: z.string().trim().max(2000).optional(),
    status: z.enum(ShootDayStatus).optional(),
    dayType: z.enum(ShootDayType).optional(),
    isNightShift: z
      .union([z.literal("on"), z.boolean()])
      .optional()
      .transform((v) => v === "on" || v === true),
  })
  .transform((data) => ({
    ...data,
    dateTo: data.dateTo?.trim() || data.dateFrom,
  }))
  .refine(
    (data) => {
      const from = new Date(data.dateFrom);
      const to = new Date(data.dateTo);
      return !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to >= from;
    },
    { message: "Дата окончания должна быть не раньше начала" },
  )
  .refine(
    (data) => {
      const from = new Date(data.dateFrom);
      const to = new Date(data.dateTo);
      const days =
        Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
      return days >= 1 && days <= 366;
    },
    { message: "Период не может быть больше 366 дней" },
  )
  .refine(
    (data) => data.dayNumber + countDaysInRange(data.dateFrom, data.dateTo) - 1 <= 9999,
    { message: "Слишком много дней для указанного номера" },
  );

function countDaysInRange(from: string, to: string) {
  const start = new Date(from);
  const end = new Date(to);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export const assignSceneSchema = z.object({
  shootDayId: z.string().cuid(),
  sceneId: z.string().cuid(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export const reorderScenesSchema = z.object({
  shootDayId: z.string().cuid(),
  orderedIds: z.array(z.string().cuid()).min(1),
});

export const updateShootDaySchema = z
  .object({
    dayType: z.enum(ShootDayType).optional(),
    isLocked: z.boolean().optional(),
    isNightShift: z.boolean().optional(),
    comment: z.string().trim().max(2000).optional(),
    prepNote: z.string().trim().max(2000).optional(),
    date: z.string().optional(),
  })
  .partial();
