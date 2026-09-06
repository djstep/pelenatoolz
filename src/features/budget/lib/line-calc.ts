import { BudgetLineType } from "@prisma/client";

export function computeBudgetLinePlanned(input: {
  lineType: BudgetLineType;
  unitsCount: number;
  quantity: number;
  unitCost: number;
}): number {
  const units = Math.max(0, input.unitsCount);
  const qty = Math.max(0, input.quantity);
  const rate = Math.max(0, input.unitCost);

  switch (input.lineType) {
    case "PER_SHIFT":
      return units * qty * rate;
    case "ONE_TIME":
      return rate;
    case "MONTHLY":
    case "DAILY":
      return qty * rate;
    default:
      return qty * rate;
  }
}

export function defaultQuantityVariableKey(
  lineType: BudgetLineType,
): string | null {
  if (lineType === "PER_SHIFT") return "SMENY";
  return null;
}

export function quantityLabelForType(lineType: BudgetLineType): string {
  switch (lineType) {
    case "PER_SHIFT":
      return "Смены";
    case "MONTHLY":
      return "Месяцы";
    case "DAILY":
      return "Дни";
    default:
      return "Кол-во";
  }
}

export function rateLabelForType(lineType: BudgetLineType): string {
  switch (lineType) {
    case "PER_SHIFT":
      return "Ставка за смену";
    case "MONTHLY":
      return "Сумма за месяц";
    case "DAILY":
      return "Сумма за день";
    default:
      return "Сумма";
  }
}
