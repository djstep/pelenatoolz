import { LocationKind } from "@prisma/client";
import { z } from "zod";

export const locationFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sublocation: z.string().trim().max(200).optional(),
  locationKind: z.enum(LocationKind).optional(),
  hasDecoration: z
    .union([z.literal("on"), z.boolean()])
    .optional()
    .transform((v) => v === "on" || v === true),
  address: z.string().trim().max(500).optional(),
  tags: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  applyAddressToSiblings: z
    .union([z.literal("on"), z.boolean()])
    .optional()
    .transform((v) => v === "on" || v === true),
});

export const locationPhotoSchema = z.object({
  url: z.string().trim().url().max(2000),
  caption: z.string().trim().max(500).optional(),
});

export const manualRenumberSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string().cuid(),
      episodeNumber: z.coerce.number().int().min(0),
      number: z.string().trim().min(1).max(20),
      postfix: z.string().trim().max(10).optional(),
    }),
  ),
});
