import { ProductionSceneFactStatus } from "@prisma/client";
import { z } from "zod";
import { parseMmSs } from "@/shared/i18n/domain-labels";

const timeString = z.string().trim().max(10).optional().or(z.literal(""));

const mmSsSeconds = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v ? parseMmSs(v) : undefined));

export const updateProductionDayMetricsSchema = z.object({
  factShiftStart: timeString,
  factShiftEnd: timeString,
  lunchStart: timeString,
  lunchEnd: timeString,
  breakNotes: z.string().trim().max(2000).optional().or(z.literal("")),
  notes: z.string().trim().max(5000).optional().or(z.literal("")),
});

export const montageRowSchema = z.object({
  scenePart: z.string().trim().max(200).optional().or(z.literal("")),
  frame: z.string().trim().max(100).optional().or(z.literal("")),
  take: z.string().trim().max(100).optional().or(z.literal("")),
  takeStatus: z.string().trim().max(100).optional().or(z.literal("")),
  takeRuntime: z.string().trim().max(20).optional().or(z.literal("")),
  cameraFiles: z.array(z.string().trim().max(120)).max(20),
  shotSize: z.string().trim().max(100).optional().or(z.literal("")),
});

export const saveProductionSceneFactSchema = z.object({
  sceneId: z.string().cuid(),
  status: z.nativeEnum(ProductionSceneFactStatus),
  factSeconds: mmSsSeconds,
  prepStart: timeString,
  prepEnd: timeString,
  rehearsalStart: timeString,
  rehearsalEnd: timeString,
  motorStart: timeString,
  motorEnd: timeString,
  notes: z.string().trim().max(5000).optional().or(z.literal("")),
  montageRows: z.array(montageRowSchema).max(200),
});

export const updateWorkRowSchema = z.object({
  workRowId: z.string().cuid(),
  factStart: timeString,
  factEnd: timeString,
  lunchSkipped: z.boolean(),
});

export const workExtraRowSchema = z.object({
  amount: z.coerce.number(),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export const saveWorkExtrasSchema = z.object({
  workRowId: z.string().cuid(),
  extras: z.array(workExtraRowSchema).max(50),
});

export const productionSceneFactStatusLabels: Record<
  ProductionSceneFactStatus,
  string
> = {
  SHOT: "снято",
  NOT_SHOT: "не снято",
  RESHOOT_REQUIRED: "требует досъёма",
  DELETED: "удалено",
};

export const productionWorkKindLabels: Record<string, string> = {
  ACTOR: "Актёр",
  RESOURCE: "Ресурс",
  TRANSPORT: "Спецтранспорт",
  LOCATION: "Локация",
};
