import type { ColumnDef } from "@/shared/hooks/use-table-layout";

export const CHARACTER_COLUMNS: ColumnDef[] = [
  { id: "name", label: "Персонаж", defaultWidth: 180, minWidth: 120 },
  { id: "description", label: "Описание", defaultWidth: 200, minWidth: 120 },
  { id: "roleRequirements", label: "Требования", defaultWidth: 160, minWidth: 100 },
  { id: "sceneCount", label: "Сцен", defaultWidth: 72, minWidth: 56 },
  { id: "kppShiftCount", label: "Смен (КПП)", defaultWidth: 96, minWidth: 72 },
  { id: "estimatedShiftCount", label: "Смен (оценка)", defaultWidth: 110, minWidth: 80 },
  { id: "objectCount", label: "Объектов", defaultWidth: 88, minWidth: 68 },
  { id: "sceneNumbers", label: "Номера сцен", defaultWidth: 140, minWidth: 100 },
  { id: "planSeconds", label: "Хрон (план)", defaultWidth: 100, minWidth: 80 },
  { id: "locations", label: "Локации", defaultWidth: 160, minWidth: 100 },
  { id: "candidateCount", label: "Кандидаты", defaultWidth: 90, minWidth: 70 },
  { id: "castStatus", label: "Каст", defaultWidth: 120, minWidth: 90 },
  { id: "approvedActor", label: "Утверждён", defaultWidth: 140, minWidth: 100 },
];
