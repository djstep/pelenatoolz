import {
  FinanceOpCategory,
  FinanceOpType,
  PostStage,
  PostTaskStatus,
} from "@prisma/client";

export const financeOpTypeLabels: Record<FinanceOpType, string> = {
  INCOME: "Приход",
  EXPENSE: "Расход",
};

export const financeOpCategoryLabels: Record<FinanceOpCategory, string> = {
  CAST_PAY: "Гонорары актёров",
  CREW_PAY: "Зарплата группы",
  VENDOR: "Подрядчики",
  LOCATION: "Локации",
  EQUIPMENT: "Оборудование",
  TRANSPORT: "Транспорт",
  CATERING: "Питание",
  GRANT: "Грант / поддержка",
  SPONSOR: "Спонсор",
  OTHER: "Прочее",
};

export const postStageLabels: Record<PostStage, string> = {
  INGEST: "Инжест / оцифровка",
  EDIT: "Монтаж",
  VFX: "VFX",
  COLOR: "Цветокоррекция",
  SOUND: "Звук / сведение",
  GRAPHICS: "Графика / титры",
  DELIVERY: "Сдача / DCP",
};

export const postTaskStatusLabels: Record<PostTaskStatus, string> = {
  TODO: "К работе",
  IN_PROGRESS: "В работе",
  DONE: "Готово",
  BLOCKED: "Блокер",
};

export const postTaskStatusColors: Record<PostTaskStatus, string> = {
  TODO: "bg-zinc-500/20 text-zinc-300 border-zinc-400/30",
  IN_PROGRESS: "bg-sky-600/20 text-sky-200 border-sky-500/30",
  DONE: "bg-emerald-600/20 text-emerald-200 border-emerald-500/30",
  BLOCKED: "bg-red-600/20 text-red-300 border-red-500/30",
};
