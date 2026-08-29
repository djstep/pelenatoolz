import { BudgetCategory } from "@prisma/client";

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
