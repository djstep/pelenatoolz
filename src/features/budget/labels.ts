import { BudgetCategory, BudgetLineType } from "@prisma/client";

export const budgetCategoryLabels: Record<BudgetCategory, string> = {
  CAST: "Актёры",
  CREW: "Съёмочная группа",
  EQUIPMENT: "Оборудование",
  LOCATIONS: "Локации / объекты",
  TRANSPORT: "Транспорт",
  CATERING: "Питание",
  POST: "Постпродакшн",
  OTHER: "Прочее",
};

export const budgetLineTypeLabels: Record<BudgetLineType, string> = {
  PER_SHIFT: "Посменная",
  ONE_TIME: "Разовая",
  MONTHLY: "Расходы за месяц",
  DAILY: "Расходы за день",
};
