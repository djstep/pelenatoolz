import type { CounterpartyType } from "@prisma/client";

export const counterpartyTypeLabels: Record<CounterpartyType, string> = {
  LEGAL_ENTITY: "Юрлицо",
  IP: "ИП",
  INDIVIDUAL: "Физлицо",
  SELF_EMPLOYED: "Самозанятый",
};

export const COUNTERPARTY_TYPES = Object.keys(
  counterpartyTypeLabels,
) as CounterpartyType[];
