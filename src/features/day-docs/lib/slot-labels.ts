import { TimeSlotType } from "@prisma/client";

export const timeSlotTypeLabels: Record<TimeSlotType, string> = {
  MAKEUP_COSTUME: "Грим / костюм",
  REHEARSAL: "Репетиция",
  SHOOTING: "Съёмка сцены",
  LUNCH: "Обед",
  TRAVEL: "Переезд / подготовка",
  IDLE: "Простой",
};

export const resourceCategoryLabels: Record<string, string> = {
  EXTRAS: "Массовка",
  GROUP: "Групповка",
  STUNT: "Трюк / каскадёр",
  PROP: "Реквизит",
  VEHICLE: "Игровой транспорт",
  CAMERA: "Операторская техника",
  CUSTOM: "Прочее",
  MAKEUP: "Грим",
  COSTUME: "Костюм",
};
