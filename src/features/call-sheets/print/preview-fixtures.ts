import type { ElementValues } from "@/features/call-sheets/lib/sections";
import type { CallSheetPrintSource } from "@/features/call-sheets/print/print-model";

/**
 * Данные для превью листа без входа и без базы (`npm run preview:callsheet`) и для тестов.
 * Проект, люди и адреса выдуманы.
 */

type Scene = CallSheetPrintSource["day"]["scenes"][number]["scene"];
type Location = Scene["locations"][number]["location"];

const FLAT: Location = {
  name: "Квартира Орловых",
  sublocation: "Кухня",
  address: "ул. Рубинштейна, 23, кв. 14 (вход со двора, код 2314)",
};
const YARD: Location = { name: "Двор-колодец", sublocation: null, address: "ул. Рубинштейна, 23" };
const EMBANKMENT: Location = {
  name: "Набережная Мойки",
  sublocation: "Певческий мост",
  address: "наб. реки Мойки, 20",
};

function character(id: string, name: string) {
  return { character: { id, name } };
}

function scene(
  number: string,
  location: Location,
  fields: Partial<Scene> & Pick<Scene, "characters">,
): Scene {
  return {
    number,
    postfix: "",
    episodeNumber: 0,
    intExt: "INT",
    dayNight: "DAY",
    title: null,
    summary: null,
    pageCount: 1,
    planSeconds: null,
    cutAt: null,
    locations: [{ location }],
    ...fields,
  };
}

const ANNA = character("ch-anna", "Анна Орлова");
const PAVEL = character("ch-pavel", "Павел Орлов");
const VERA = character("ch-vera", "Вера Степановна");
const KIRILL = character("ch-kirill", "Кирилл");
const SLEDOV = character("ch-sledov", "Следователь Громов");
const LIZA = character("ch-liza", "Лиза (8 лет)");
const DRIVER = character("ch-driver", "Водитель «Волги»");
const WAITER = character("ch-waiter", "Официант");
const GHOST = character("ch-ghost", "Сосед снизу");

function el(name: string, fields: Partial<ElementValues> = {}): ElementValues {
  return {
    name,
    quantity: "",
    scenes: "",
    arrivalTime: "",
    readyTime: "",
    wrapTime: "",
    notes: "",
    secondUnit: false,
    ...fields,
  };
}

const SECTIONS = [
  { ref: "s-group", key: "GROUP", name: "Групповка" },
  { ref: "s-game", key: "GAME_TRANSPORT", name: "Игровой транспорт" },
  { ref: "s-props", key: "PROPS", name: "Реквизит" },
  { ref: "s-costume", key: "COSTUME", name: "Костюм" },
  { ref: "s-makeup", key: "MAKEUP", name: "Грим" },
  { ref: "s-stunts", key: "STUNTS", name: "Трюки" },
  { ref: "s-sfx", key: "SFX", name: "Спецэффекты" },
  { ref: "s-camera", key: "CAMERA", name: "Опер. техника" },
  { ref: "s-cg", key: "CG", name: "CG" },
  { ref: "s-special", key: "SPECIAL_TRANSPORT", name: "Спецтранспорт" },
  { ref: "s-other", key: "OTHER", name: "Прочее" },
];

/** Насыщенный день: 13 руководителей, 11 цехов, 8 актёров, 3 объекта, 7 разделов элементов. */
export const FULL_DAY_SOURCE: CallSheetPrintSource = {
  project: { name: "Северный ветер", fullName: "Северный ветер (сериал, 8 серий)" },
  day: {
    date: new Date("2026-11-03T00:00:00.000Z"),
    shiftNumber: 12,
    isNightShift: false,
    callTime: "06:30",
    wrapTime: "19:30",
    shiftStartTime: "07:00",
    rehearsalTime: "07:45",
    motorOnTime: "08:30",
    motorOffTime: "19:00",
    crewMeetAddress: "м. «Достоевская», выход к Владимирской площади, автобус группы",
    crewMeetTime: "06:15",
    weatherNote: null,
    weatherPrecip: null,
    scenes: [
      {
        estimatedPages: null,
        scene: scene("14", FLAT, {
          pageCount: 1.25,
          planSeconds: 95,
          summary: "Утро. Анна находит в почте письмо без обратного адреса и прячет его от Павла.",
          characters: [ANNA, PAVEL, LIZA],
        }),
      },
      {
        estimatedPages: null,
        scene: scene("15", FLAT, {
          pageCount: 2,
          planSeconds: 140,
          summary: "Ссора на кухне. Вера Степановна заступается за Анну.",
          characters: [ANNA, PAVEL, VERA],
        }),
      },
      {
        estimatedPages: null,
        scene: scene("15", FLAT, {
          postfix: "А",
          pageCount: 0.5,
          planSeconds: 60,
          summary: "Лиза подслушивает из коридора.",
          characters: [LIZA],
        }),
      },
      {
        estimatedPages: null,
        scene: scene("16", FLAT, {
          pageCount: 1,
          planSeconds: 80,
          summary: "Сосед снизу жалуется на шум (сцена вырезана).",
          characters: [ANNA, GHOST],
          cutAt: new Date("2026-10-30T10:00:00.000Z"),
        }),
      },
      {
        estimatedPages: 2.5,
        scene: scene("22", YARD, {
          intExt: "EXT",
          pageCount: 2.75,
          planSeconds: 210,
          summary:
            "Кирилл ждёт Анну во дворе под дождём. Громов наблюдает из машины. Драка у арки, Кирилл падает на капот «Волги».",
          characters: [ANNA, KIRILL, SLEDOV, DRIVER],
        }),
      },
      {
        estimatedPages: null,
        scene: scene("23", EMBANKMENT, {
          intExt: "EXT",
          dayNight: "DUSK",
          pageCount: 0.75,
          planSeconds: 75,
          summary: "Анна бросает письмо в Мойку.",
          characters: [ANNA],
        }),
      },
      {
        estimatedPages: null,
        scene: scene("31", EMBANKMENT, {
          intExt: "INT_EXT",
          dayNight: "DUSK",
          pageCount: 1.5,
          planSeconds: 120,
          title: "Кафе на набережной",
          summary: null,
          characters: [SLEDOV, KIRILL, WAITER],
        }),
      },
    ],
    timeSlots: [
      { startTime: "07:00", endTime: "07:45", slotType: "MAKEUP_COSTUME", unit: "MAIN" },
      { startTime: "13:30", endTime: "14:30", slotType: "LUNCH", unit: "MAIN" },
      { startTime: "12:00", endTime: "12:45", slotType: "LUNCH", unit: "SECOND" },
    ],
    actorCalls: [
      { actorId: "a-anna", pickupTime: "05:50", arrivalTime: "06:30", makeupTime: "06:35", costumeTime: "07:20", readyTime: "07:40", wrapTime: "18:45", transportMode: "CAR", transportText: null },
      { actorId: "a-pavel", pickupTime: null, arrivalTime: "06:45", makeupTime: "06:50", costumeTime: "07:25", readyTime: "07:45", wrapTime: "11:30", transportMode: "SELF", transportText: null },
      { actorId: "a-vera", pickupTime: "07:30", arrivalTime: "08:15", makeupTime: "08:20", costumeTime: "09:00", readyTime: "09:20", wrapTime: "11:30", transportMode: "CAR", transportText: null },
      { actorId: "a-kirill", pickupTime: null, arrivalTime: "11:00", makeupTime: "11:05", costumeTime: "11:40", readyTime: "12:00", wrapTime: "19:00", transportMode: "CUSTOM", transportText: "такси, чек — администратору" },
      { actorId: "a-sledov", pickupTime: "10:15", arrivalTime: "11:15", makeupTime: "11:20", costumeTime: "11:50", readyTime: "12:10", wrapTime: "19:00", transportMode: "CAR", transportText: null },
      { actorId: "a-liza", pickupTime: null, arrivalTime: "07:15", makeupTime: "07:20", costumeTime: "07:40", readyTime: "08:00", wrapTime: "11:00", transportMode: "CUSTOM", transportText: "с мамой, на своей машине" },
      { actorId: "a-driver", pickupTime: null, arrivalTime: "13:00", makeupTime: null, costumeTime: "13:15", readyTime: "13:40", wrapTime: "17:30", transportMode: "SELF", transportText: null },
      { actorId: "a-waiter", pickupTime: null, arrivalTime: "15:30", makeupTime: "15:35", costumeTime: "15:50", readyTime: "16:10", wrapTime: "19:00", transportMode: null, transportText: null },
    ],
    transports: [
      { name: "Дождевальная машина (АЦ-40)", callTime: "12:00", wrapTime: "17:30", scenes: "22", notes: "Вода — от гидранта во дворе, разрешение у администратора" },
      { name: "Автокран 25 т под световую корзину", callTime: "11:30", wrapTime: "19:30", scenes: "22, 23", notes: null },
    ],
  },
  actors: [
    { id: "a-anna", characterId: "ch-anna", lastName: "Соколова", firstName: "Мария" },
    { id: "a-pavel", characterId: "ch-pavel", lastName: "Ветров", firstName: "Алексей" },
    { id: "a-vera", characterId: "ch-vera", lastName: "Голубева-Ржевская", firstName: "Наталья" },
    { id: "a-kirill", characterId: "ch-kirill", lastName: "Мельников", firstName: "Даниил" },
    { id: "a-sledov", characterId: "ch-sledov", lastName: "Карпенко", firstName: "Игорь" },
    { id: "a-liza", characterId: "ch-liza", lastName: "Петрова", firstName: "Ева" },
    { id: "a-driver", characterId: "ch-driver", lastName: "Байрамов", firstName: "Тимур" },
    { id: "a-waiter", characterId: "ch-waiter", lastName: "Лисицын", firstName: "Олег" },
    { id: "a-ghost", characterId: "ch-ghost", lastName: "Зайцев", firstName: "Пётр" },
  ],
  workingDay: { index: 12, total: 40 },
  astro: {
    sunrise: "08:21",
    sunset: "16:38",
    weatherSummary: "Пасмурно, дождь",
    precipProb: 70,
    tempMax: 6.4,
    tempMin: 2.1,
  },
  sheet: {
    tempDay: "+6",
    tempNight: "+2",
    importantNote:
      "Сцена 22 — дождь от АЦ-40 с 12:00: всем цехам иметь дождевики и чехлы на технику, осветителям — укрыть приборы во дворе до начала полива.\n" +
      "Во дворе жилой дом: не шуметь до 09:00, курение только у арки, мусор не оставлять. Машины группы во двор не заезжают — парковка на ул. Правды.\n" +
      "Лиза (8 лет) на площадке не дольше 4 часов, с мамой. Сцены с ней — первыми.\n" +
      "Трюк в сцене 22 (падение на капот) — только после брифинга каскадёров и в их присутствии; посторонним в зоне трюка не находиться.",
    actorRestrictions:
      "Соколова М. — до 19:00 (спектакль). Ветров А. — только до 12:00. Петрова Е. (8 лет) — не более 4 часов на площадке, с законным представителем.",
    leaders: [
      { position: "Режиссёр-постановщик", personName: "Андрей Лаптев", phone: "+7 921 555-01-01" },
      { position: "Оператор-постановщик", personName: "Глеб Сорокин", phone: "+7 921 555-01-02" },
      { position: "Исполнительный продюсер", personName: "Ольга Кравец", phone: "+7 911 555-01-03" },
      { position: "Директор картины", personName: "Сергей Михайлов", phone: "+7 911 555-01-04" },
      { position: "Второй режиссёр", personName: "Ирина Белова", phone: "+7 931 555-01-05" },
      { position: "Второй режиссёр по площадке", personName: "Денис Фомин", phone: "+7 931 555-01-06" },
      { position: "Ассистент по актёрам", personName: "Юлия Гаврилова", phone: "+7 950 555-01-07" },
      { position: "Администратор площадки", personName: "Руслан Ахмедов", phone: "+7 950 555-01-08" },
      { position: "Художник-постановщик", personName: "Вадим Ершов", phone: "+7 921 555-01-09" },
      { position: "Художник по костюмам", personName: "Алла Жукова", phone: "+7 921 555-01-10" },
      { position: "Художник по гриму", personName: "Светлана Олейник", phone: "+7 911 555-01-11" },
      { position: "Звукорежиссёр", personName: "Артём Дьяконов", phone: "+7 911 555-01-12" },
      { position: "Каскадёр-постановщик", personName: "Николай Шубин", phone: "+7 999 555-01-13" },
    ],
    crewCalls: [
      { label: "Осветители", callTime: "05:45" },
      { label: "Художники-постановщики", callTime: "06:00" },
      { label: "Грим", callTime: "06:00" },
      { label: "Костюм", callTime: "06:00" },
      { label: "Операторский цех", callTime: "06:30" },
      { label: "Механики (грип)", callTime: "06:30" },
      { label: "Реквизит", callTime: "06:30" },
      { label: "Звук", callTime: "07:00" },
      { label: "Видеоинженер / плейбек", callTime: "07:00" },
      { label: "Пиротехники и SFX", callTime: "11:00" },
      { label: "Каскадёры", callTime: "11:30" },
    ],
    baseItems: [
      { name: "Автобус группы", callTime: "06:00", notNeeded: false },
      { name: "Вагон-грим", callTime: "05:45", notNeeded: false },
      { name: "Вагон-костюм", callTime: "05:45", notNeeded: false },
      { name: "Актёрский вагон", callTime: "06:15", notNeeded: false },
      { name: "Кейтеринг (завтрак)", callTime: "06:00", notNeeded: false },
      { name: "Генератор 100 кВт", callTime: "05:30", notNeeded: false },
      { name: "Туалетный модуль", callTime: "06:00", notNeeded: false },
      { name: "Вагон режиссёра", callTime: null, notNeeded: true },
    ],
  },
  elements: {
    sections: SECTIONS,
    autoRows: [
      { sectionRef: "s-group", hidden: false, value: el("Прохожие с зонтами", { quantity: "12", scenes: "22", arrivalTime: "11:30", readyTime: "12:15", wrapTime: "17:30" }) },
      { sectionRef: "s-group", hidden: false, value: el("Посетители кафе", { quantity: "8", scenes: "31", arrivalTime: "15:00", readyTime: "15:45", wrapTime: "19:00" }) },
      { sectionRef: "s-game", hidden: false, value: el("ГАЗ-21 «Волга», чёрная", { quantity: "1", scenes: "22", arrivalTime: "12:30", readyTime: "13:30", wrapTime: "17:30", notes: "с водителем-дублёром" }) },
      { sectionRef: "s-props", hidden: false, value: el("Письмо в конверте без адреса", { quantity: "6", scenes: "14, 23", notes: "дубли — намокают" }) },
      { sectionRef: "s-props", hidden: false, value: el("Почтовый ящик (лицевая панель)", { scenes: "14" }) },
      { sectionRef: "s-props", hidden: true, value: el("Газета «Смена»", { scenes: "16" }) },
      { sectionRef: "s-props", hidden: false, value: el("Сервиз на 6 персон, разбиваемая тарелка", { quantity: "3 тарелки", scenes: "15" }) },
      { sectionRef: "s-costume", hidden: false, value: el("Плащ Кирилла, мокрый + сухой дубль", { quantity: "2", scenes: "22" }) },
      { sectionRef: "s-costume", hidden: false, value: el("Форма официанта", { quantity: "1", scenes: "31" }) },
      { sectionRef: "s-makeup", hidden: false, value: el("Ссадина на скуле (Кирилл)", { scenes: "22, 31", readyTime: "12:00" }) },
      { sectionRef: "s-stunts", hidden: false, value: el("Падение на капот", { quantity: "дублёр + страховка", scenes: "22", arrivalTime: "11:30", readyTime: "14:00", wrapTime: "16:00" }) },
      { sectionRef: "s-sfx", hidden: false, value: el("Дождь (2 стойки + АЦ-40)", { scenes: "22", arrivalTime: "11:00", readyTime: "12:30", wrapTime: "17:30" }) },
      { sectionRef: "s-sfx", hidden: false, value: el("Дым (лёгкий, кафе)", { scenes: "31", readyTime: "16:00" }) },
      { sectionRef: "s-camera", hidden: false, value: el("Стедикам", { scenes: "22, 23", arrivalTime: "11:00", wrapTime: "19:00" }) },
      { sectionRef: "s-camera", hidden: false, value: el("Кран «Супертехнокран 15»", { scenes: "22", arrivalTime: "10:00", readyTime: "12:30", wrapTime: "17:30", secondUnit: false }) },
    ],
    manual: [
      { sectionRef: "s-camera", ...el("Вторая камера (общий план набережной)", { scenes: "23", arrivalTime: "15:00", secondUnit: true }) },
      { sectionRef: "s-cg", ...el("Маркеры на окнах дома напротив", { scenes: "22", notes: "снять до 17:00" }) },
    ],
  },
};

/** Минимальный день: вызывной создан, но почти пуст. */
export const MIN_DAY_SOURCE: CallSheetPrintSource = {
  project: { name: "Короткий метр", fullName: null },
  day: {
    date: new Date("2026-11-05T00:00:00.000Z"),
    shiftNumber: 1,
    isNightShift: false,
    callTime: "09:00",
    wrapTime: null,
    shiftStartTime: null,
    rehearsalTime: null,
    motorOnTime: null,
    motorOffTime: null,
    crewMeetAddress: null,
    crewMeetTime: null,
    weatherNote: null,
    weatherPrecip: null,
    scenes: [
      {
        estimatedPages: null,
        scene: scene("1", { name: "Парк", sublocation: null, address: null }, {
          intExt: "EXT",
          pageCount: null,
          characters: [character("ch-hero", "Герой")],
        }),
      },
    ],
    timeSlots: [],
    actorCalls: [],
    transports: [],
  },
  actors: [{ id: "a-hero", characterId: "ch-hero", lastName: "Иванов", firstName: "Иван" }],
  workingDay: { index: 1, total: 3 },
  astro: null,
  sheet: {
    tempDay: null,
    tempNight: null,
    importantNote: null,
    actorRestrictions: "  ",
    leaders: [
      { position: "Режиссёр", personName: "Анна Смирнова", phone: null },
      { position: "Директор", personName: "Пётр Котов", phone: "+7 900 000-00-00" },
    ],
    crewCalls: [],
    baseItems: [],
  },
  elements: { sections: SECTIONS, autoRows: [], manual: [] },
};
