import { z } from "zod";

const optionalCuid = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.string().cuid().optional(),
);

const money = z.coerce.number().min(0).max(1_000_000_000_000);

export const contractFormSchema = z.object({
  date: z.string().min(1),
  number: z.string().trim().min(1).max(80),
  companyId: z.string().cuid(),
  counterpartyId: z.string().cuid(),
  ledgerTypeId: optionalCuid,
  amount: money,
  vatEnabled: z.boolean().default(true),
  vatRate: z.coerce.number().min(0).max(100).optional().nullable(),
  vatAmountManual: z.coerce.number().min(0).optional().nullable(),
  isPreliminary: z.boolean().default(false),
  statusId: z.string().cuid(),
  tags: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  summary: z.string().trim().max(5000).optional().nullable(),
  comment: z.string().trim().max(5000).optional().nullable(),
  creditsName: z.string().trim().max(200).optional().nullable(),
});

export const actFormSchema = z.object({
  date: z.string().min(1),
  number: z.string().trim().min(1).max(80),
  companyId: z.string().cuid(),
  counterpartyId: z.string().cuid(),
  contractId: optionalCuid,
  paymentId: optionalCuid,
  amount: money,
  vatEnabled: z.boolean().default(false),
  vatRate: z.coerce.number().min(0).max(100).optional().nullable(),
  vatAmountManual: z.coerce.number().min(0).optional().nullable(),
  statusId: z.string().cuid(),
  summary: z.string().trim().max(5000).optional().nullable(),
  comment: z.string().trim().max(5000).optional().nullable(),
});

export const certificateFormSchema = actFormSchema;
export type ContractFormInput = z.infer<typeof contractFormSchema>;
export type ActFormInput = z.infer<typeof actFormSchema>;
export type CertificateFormInput = ActFormInput;
