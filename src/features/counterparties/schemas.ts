import { CounterpartyType } from "@prisma/client";
import { z } from "zod";

export const companySchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(200),
  requisites: z.string().trim().max(5000).optional(),
  inn: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const counterpartySchema = z.object({
  name: z.string().trim().min(1, "Укажите название").max(200),
  type: z.enum(CounterpartyType),
  contacts: z.string().trim().max(2000).optional(),
  inn: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type CompanyFormValues = z.infer<typeof companySchema>;
export type CounterpartyFormValues = z.infer<typeof counterpartySchema>;
