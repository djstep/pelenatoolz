import type { PrepEventColor } from "@/features/prep-calendar/lib/event-colors";

/** Начальный справочник нового проекта. Этот же список вставляет миграция `prep_calendar`. */
export const DEFAULT_PREP_EVENT_TYPES: readonly { name: string; color: PrepEventColor }[] = [
  { name: "Встреча", color: "blue" },
  { name: "Читка", color: "violet" },
  { name: "Выбор объекта", color: "green" },
  { name: "Техпроход", color: "teal" },
  { name: "Примерка", color: "pink" },
  { name: "Грим-тест", color: "amber" },
  { name: "Репетиция", color: "red" },
  { name: "Тест камеры", color: "teal" },
  { name: "Производственное совещание", color: "blue" },
  { name: "Другое", color: "gray" },
];

/** Строки для `prepEventType.createMany`. */
export function defaultPrepEventTypeRows(projectId: string) {
  return DEFAULT_PREP_EVENT_TYPES.map((type, sortOrder) => ({ ...type, projectId, sortOrder }));
}
