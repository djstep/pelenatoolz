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
  /** Команда: просмотр и правка, но без контактов и без договоров. */
  crewonly: { key: "crewonly", email: "e2e-crewonly@pelena.test", name: "E2E Только команда" },
} as const;

export type E2ERoleKey = keyof typeof E2E_ROLES;

export const E2E_ROLE_NAMES = {
  nofin: "E2E без финансов",
  nocallsheet: "E2E без вызывных",
  crewonly: "E2E без договоров и контактов",
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

/**
 * Дни для вида печатного листа (сид дописывает их и в уже созданный проект): 4 — вызывной
 * заполнен целиком (все блоки макета), 5 — рабочий день без данных и без вызывного.
 */
export const LAYOUT_DAYS = {
  filled: { dayNumber: 4, date: "2026-11-13" },
  empty: { dayNumber: 5, date: "2026-11-14" },
} as const;

/** Тексты заполненного дня 4 — по ним e2e проверяет блоки листа. */
export const FILLED_DAY = {
  crewMeetAddress: "Москва, ул. Тестовая, 1, проходная 3",
  important: "Всем иметь при себе паспорт: вход по пропускам",
  restrictions: "Тестов — не позже 20:00",
  leader: "Иванова Ольга",
  crew: "Операторский цех",
  base: "Фудтрак E2E",
  group: "Дублёр Ивана E2E",
  element: "Зонт чёрный E2E",
  secondUnit: "Детали интерьера E2E",
  schemePoint: "Основной караван E2E",
} as const;

/**
 * Договоры и люди команды. Контрагент К1 уже в команде; К2 и К3 — для «Подтянуть»; ООО в
 * «Подтянуть» не попадает. Сумма не должна дойти до экрана команды ни у кого.
 */
export const CREW = {
  contractAmount: "73519.47",
  contracts: {
    individual: {
      counterparty: "Светов Игорь Павлович",
      type: "INDIVIDUAL",
      contacts: "+7 900 111-22-33, svetov@e2e.test",
      number: "E2E-К1",
    },
    selfEmployed: {
      counterparty: "Гримова Анна Сергеевна",
      type: "SELF_EMPLOYED",
      contacts: "8 (900) 222-33-44 anna.grim@e2e.test",
      number: "E2E-К2",
    },
    ip: {
      counterparty: "ИП Звуков Олег Иванович",
      type: "IP",
      contacts: "тел. +7 900 333-44-55",
      number: "E2E-К3",
    },
    llc: {
      counterparty: "ООО «Свет и кран E2E»",
      type: "LEGAL_ENTITY",
      contacts: "+7 495 000-00-01, office@e2e.test",
      number: "E2E-К4",
    },
  },
  /** В команде по договору К1. */
  linked: {
    lastName: "Светов",
    firstName: "Игорь",
    middleName: "Павлович",
    position: "Осветитель",
    phone: "+7 900 111-22-33",
    email: "svetov@e2e.test",
  },
  /** Добавлен вручную, без договора. */
  manual: {
    lastName: "Вручнов",
    firstName: "Пётр",
    position: "Водитель",
    phone: "+7 900 777-88-99",
    email: "vruchnov@e2e.test",
    note: "Заметка сида",
  },
} as const;

export const NAMES = {
  actor: { lastName: "Тестов", firstName: "Пётр" },
  actor2: { lastName: "Проверкина", firstName: "Анна" },
  character: "Иван",
  character2: "Мария",
  location: "Квартира Ивановых",
  vehicle: "Volvo XC90 E2E",
  transport: "Автокран E2E",
  castingPerson: { lastName: "Кандидатов", firstName: "Олег" },
  /** Цех тестов смет: на нём смету создают сами тесты (c8, c10, c12), в сиде её нет. */
  transportDepartment: "Транспортный цех",
  /** Цех со сметой из сида — для снимков редактора сметы. */
  smetaDepartment: "Операторский цех",
  company: "ООО «Студия E2E»",
  counterparty: "ИП Подрядчик E2E",
  contract: "E2E-1",
  audition: "Проба E2E",
  scout: "Дача E2E",
} as const;
