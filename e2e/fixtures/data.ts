/**
 * Данные тестового проекта «E2E приёмка». Суммы нарочно необычные: по ним тесты ищут
 * утечку ставок в HTML, ответах `?_rsc`, Excel и листе печати. Паролей здесь нет —
 * они в `.env.e2e` (в .gitignore).
 */

export const E2E_PROJECT_NAME = "E2E приёмка";

export const E2E_ROLES = {
  producer: { key: "producer", email: "e2e-producer@pelena.test", name: "E2E Продюсер" },
  nofin: { key: "nofin", email: "e2e-nofin@pelena.test", name: "E2E Без финансов" },
  nocallsheet: { key: "nocallsheet", email: "e2e-nocallsheet@pelena.test", name: "E2E Без вызывных" },
} as const;

export type E2ERoleKey = keyof typeof E2E_ROLES;

export const E2E_ROLE_NAMES = {
  nofin: "E2E без финансов",
  nocallsheet: "E2E без вызывных",
} as const;

/** Переменные `.env.e2e`: пароль роли. */
export function passwordEnvName(role: E2ERoleKey) {
  return `E2E_${role.toUpperCase()}_PASSWORD`;
}

/** Ставки и суммы тестового проекта — ни одна не должна дойти до роли без финансов. */
export const MONEY = {
  actorShiftRate: "48317.53",
  actorTaxPercent: "17.31",
  actorOvertimeAmount: "4913.71",
  actorExtraPayment: "7129.43",
  actor2ShiftRate: "52941.17",
  locationShiftRate: "61529.37",
  locationTaxPercent: "6.23",
  vehicleShiftRate: "23917.61",
  vehicleKmRate: "47.83",
  resourceTaxPercent: "13.79",
  propShiftRate: "31873.29",
  generatorShiftRate: "15473.91",
  transportKmRate: "58.61",
  castingProposedRate: "83641.29",
  sceneResourceUnitPrice: "27314.47",
  budgetRate: "39271.13",
  reportTotalPay: "56681.29",
  reportMileagePay: "7032.17",
} as const;

/** Имена денежных полей — не должны встречаться в данных страниц для роли без финансов. */
export const MONEY_FIELD_NAMES = [
  "kmRate",
  "shiftRate",
  "taxPercent",
  "unitPrice",
  "proposedRate",
  "shiftPay",
  "overtimePay",
  "extrasPay",
  "mileagePay",
  "totalPay",
  "overtimeRates",
  "extraPayments",
] as const;

/** Дни КПП: 1 и 2 рабочие (у дня 1 вызывной уже создан), 3 — выходной. */
export const DAYS = [
  { dayNumber: 1, date: "2026-11-10", dayType: "WORKING" },
  { dayNumber: 2, date: "2026-11-11", dayType: "WORKING" },
  { dayNumber: 3, date: "2026-11-12", dayType: "OFF" },
] as const;

export const NAMES = {
  actor: { lastName: "Тестов", firstName: "Пётр" },
  actor2: { lastName: "Проверкина", firstName: "Анна" },
  character: "Иван",
  character2: "Мария",
  location: "Квартира Ивановых",
  vehicle: "Volvo XC90 E2E",
  transport: "Автокран E2E",
  castingPerson: { lastName: "Кандидатов", firstName: "Олег" },
} as const;
