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
  TODO: "bg-[var(--glass-badge-bg)] text-[var(--tone-neutral)] border-[var(--border)]",
  IN_PROGRESS: "bg-[var(--tone-info-bg)] text-[var(--tone-info-soft)] border-[var(--tone-info-line)]",
  DONE: "bg-[var(--tone-success-bg)] text-[var(--tone-success-soft)] border-[var(--tone-success-line)]",
  BLOCKED: "bg-[var(--tone-danger-bg)] text-[var(--tone-danger)] border-[var(--tone-danger-line)]",
};
