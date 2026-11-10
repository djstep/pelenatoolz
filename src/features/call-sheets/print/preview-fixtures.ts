import type { ElementValues } from "@/features/call-sheets/lib/sections";
import type { CallSheetPrintSource } from "@/features/call-sheets/print/print-model";

/**
 * Данные для превью листа без входа и без базы (`npm run preview:callsheet`) и для тестов.
 * «ИРП» — данные из макета владельца (`docs/callsheet-mockup-v5.html`); остальные проекты,
 * люди и адреса выдуманы.
 */

type Day = CallSheetPrintSource["day"];
type Scene = Day["scenes"][number]["scene"];
type Slot = Day["timeSlots"][number];
type ActorCall = Day["actorCalls"][number];
type Location = Scene["locations"][number]["location"];

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
    scriptDay: null,
    title: null,
    summary: null,
    planSeconds: null,
    cutAt: null,
    locations: [{ location }],
    ...fields,
  };
}

function slot(
  startTime: string,
  endTime: string | null,
  slotType: Slot["slotType"],
  fields: Partial<Slot> = {},
): Slot {
  return {
    startTime,
    endTime,
    slotType,
    unit: "MAIN",
    notes: null,
    customLabel: null,
    isContinuation: false,
    scene: null,
    ...fields,
  };
}

function call(actorId: string, fields: Partial<ActorCall>): ActorCall {
  return {
    actorId,
    arrivalTime: null,
    makeupTime: null,
    costumeTime: null,
    readyTime: null,
    wrapTime: null,
    transportMode: null,
    transportText: null,
    carPickupTime: null,
    ...fields,
  };
}

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

// ---------------------------------------------------------------------------
// ИРП — день из макета владельца (3 листа).
// ---------------------------------------------------------------------------

const IRP_ADDRESS = "пр. Стачек, 47Е";
const GATE: Location = { name: "Проходная 3", parent: { name: "Завод" }, address: IRP_ADDRESS };
const BMW_CABIN: Location = { name: "Кабина БМВ", parent: null, address: IRP_ADDRESS };
const TRACTOR_CABIN: Location = { name: "Кабина трактора", parent: { name: "Завод" }, address: IRP_ADDRESS };
const COLLECTOR_1 = character("ch-c1", "Коллектор 1");
const COLLECTOR_2 = character("ch-c2", "Коллектор 2");

const IRP_129 = scene("129", GATE, {
  intExt: "EXT",
  dayNight: "DAWN",
  scriptDay: 10,
  planSeconds: 10,
  summary:
    "Коллекторы прыгают в БМВ, преграждают въезд на завод. Трактор едет к ним и останавливается метрах в пяти.",
  characters: [COLLECTOR_1, COLLECTOR_2],
});
const IRP_130 = scene("130", BMW_CABIN, {
  intExt: "INT",
  dayNight: "DAWN",
  scriptDay: 10,
  planSeconds: 7,
  summary: "Коллекторы в машине, подъезжает трактор.",
  characters: [COLLECTOR_1, COLLECTOR_2],
});
const IRP_132 = scene("132", GATE, {
  intExt: "EXT",
  dayNight: "DAY",
  scriptDay: 10,
  planSeconds: 20,
  summary:
    "Трактор едет на машину коллекторов. Коллекторы резко сдают назад и врезаются в бетонное ограждение парковки.",
  characters: [COLLECTOR_1, COLLECTOR_2],
});
/** Сцена 2-го юнита — из либретто, в дне КПП её нет. */
const IRP_131 = scene("131", TRACTOR_CABIN, {
  intExt: "EXT",
  dayNight: "DAY",
  scriptDay: 10,
  summary: "Детали внутри кабины.",
  characters: [],
});

const IRP_READY = { readyTime: "09:00", wrapTime: "19:30" };
const ALL_SCENES = "129, 130, 132";
const PREP_FIX = "Подготовка, поправки по гриму, костюму, реквизиту";

export const IRP_DAY_SOURCE: CallSheetPrintSource = {
  project: { name: "ИРП", fullName: null },
  day: {
    date: new Date("2026-09-11T00:00:00.000Z"),
    shiftNumber: 40,
    isNightShift: false,
    callTime: "07:30",
    wrapTime: "19:30",
    shiftStartTime: "07:30",
    rehearsalTime: "09:00",
    motorOnTime: "09:30",
    motorOffTime: "19:30",
    crewMeetAddress: IRP_ADDRESS,
    crewMeetTime: "07:30",
    weatherNote: null,
    weatherPrecip: null,
    scenes: [{ scene: IRP_129 }, { scene: IRP_130 }, { scene: IRP_132 }],
    timeSlots: [
      slot("07:30", "09:00", "MAKEUP_COSTUME", { customLabel: "Грим, костюм, техническое освоение" }),
      slot("09:00", "09:30", "REHEARSAL"),
      slot("09:30", "12:00", "SHOOTING", {
        scene: IRP_129,
        notes: "Поставить хореографию сцены на GoPro. Держать 2 трактора: под грип и под внешние планы.",
      }),
      slot("12:00", "12:30", "PREP"),
      slot("12:30", "13:30", "SHOOTING", { scene: IRP_130 }),
      slot("13:30", "14:30", "LUNCH"),
      slot("14:30", "15:30", "SHOOTING", { scene: IRP_130, isContinuation: true }),
      slot("15:30", "16:00", "PREP", { customLabel: PREP_FIX }),
      slot("16:00", "16:30", "PREP", { customLabel: PREP_FIX }),
      slot("16:30", "19:30", "SHOOTING", { scene: IRP_132 }),
      slot("16:00", "19:30", "SHOOTING", { unit: "SECOND", scene: IRP_131 }),
    ],
    actorCalls: [
      call("a-gromov", {
        transportMode: "CAR",
        carPickupTime: "07:15",
        arrivalTime: "08:00",
        costumeTime: "08:00",
        makeupTime: "08:30",
        ...IRP_READY,
      }),
      call("a-tagirov", {
        transportMode: "SELF",
        arrivalTime: "08:00",
        costumeTime: "08:00",
        makeupTime: "08:30",
        ...IRP_READY,
      }),
    ],
    transports: [{ name: "Манипулятор", callTime: null, wrapTime: "19:30", scenes: "132", notes: null }],
  },
  actors: [
    { id: "a-gromov", characterId: "ch-c1", lastName: "Громов", firstName: "Игорь" },
    { id: "a-tagirov", characterId: "ch-c2", lastName: "Тагиров", firstName: "Алан" },
  ],
  workingDay: null,
  astro: {
    sunrise: "06:18",
    sunset: "19:36",
    weatherSummary: "Переменная облачность, небольшой дождь",
    precipProb: null,
    tempMax: 15.6,
    tempMin: 11.8,
  },
  sheet: {
    tempDay: "+16",
    tempNight: "+12",
    importantNote: "Всем иметь при себе паспорт: вход на территорию завода строго по пропускам.",
    actorRestrictions: null,
    schemeLocation: {
      name: "Завод",
      parent: null,
      address: IRP_ADDRESS,
      directions: "Ближайшее метро — «Кировский завод», дальше пешком до проходной 3",
      parking: null,
      onSiteNotes: "Администратор у проходной с 07:00, телефон — лист 1",
      points: [
        { number: "1", name: "Проходная 3 · место сбора", description: "Вход по пропускам, нужен паспорт. Сбор 07:30" },
        { number: "2", name: "Основной караван", description: "Штаб, грим, костюм, актёрская, фудтрак" },
        { number: "3", name: "Съёмочная площадка", description: "Сцены 129, 130, 132 · 2-й юнит рядом" },
      ],
    },
    leaders: [
      ["Исполнительный продюсер", "Миронова Татьяна"],
      ["Режиссёр-постановщик", "Зайцев Кирилл"],
      ["Второй режиссёр", "Лебедев Иван"],
      ["Директор группы", "Гусев Павел"],
      ["Зам. директора", "Котов Сергей"],
      ["Администратор", "Никитин Олег"],
      ["Оператор-постановщик", "Власов Никита"],
      ["Художник-постановщик", "Ткаченко Ольга"],
      ["Худ. по реквизиту", "Шилов Артём"],
      ["Худ. по костюму", "Романова Алина"],
      ["Худ. по гриму", "Яковлева Дарья"],
      ["Звукорежиссёр", "Егоров Роман"],
      ["Скрипт-супервайзер", "Панова Вера"],
      ["Ассистент по актёрам", "Ким Алиса"],
      ["CG-супервайзер", "Белов Кирилл"],
    ].map(([position, personName], i) => ({
      position: position!,
      shortTitle: null,
      personName: personName!,
      phone: `+7 900 000-00-${String(i + 1).padStart(2, "0")}`,
    })),
    crewCalls: [
      ["Администрация", "06:30"],
      ["Рабочие, буфет", "06:30"],
      ["Локейшн", "06:30"],
      ["Режиссёрская группа", "07:30"],
      ["Плейбек, механики", "07:30"],
      ["Второй оператор", "07:30"],
      ["Гаффер", "07:30"],
      ["Осветители", "07:30"],
      ["Художники-постановщики", "07:30"],
      ["Реквизит", "07:30"],
      ["Каскадёры, пиротехники", "07:30"],
      ["Ассистент по актёрам", "08:00"],
      ["Фокус-пуллер", "08:00"],
      ["Стедикам", "08:00"],
      ["Костюм, грим", "08:00"],
      ["CG-супервайзер", "08:00"],
      ["Оператор-постановщик", "08:20"],
      ["Звук", "08:20"],
    ].map(([label, callTime]) => ({ label: label!, callTime: callTime! })),
    baseItems: [
      ["Фудтрак", "06:10"],
      ["Светобаза, генератор", "06:10"],
      ["АХЧ", "06:30"],
      ["Туалет", "06:30"],
      ["Штаб", "07:30"],
      ["Актёрская", "07:30"],
      ["Грим, костюм", "07:30"],
      ["Худваген", "07:30"],
      ["Камерваген", "07:30"],
      ["Реквизиторская", "07:30"],
      ["Тонваген", "08:20"],
      ["Гриптрак", null],
    ].map(([name, callTime]) => ({ name: name!, callTime, notNeeded: callTime === null })),
  },
  elements: {
    sections: SECTIONS,
    autoRows: [
      { sectionRef: "s-group", hidden: false, value: el("Дублёр Коллектора 2", { quantity: "1", scenes: ALL_SCENES, ...IRP_READY }) },
      { sectionRef: "s-group", hidden: false, value: el("Водитель беспилотного трактора", { quantity: "1", scenes: ALL_SCENES, ...IRP_READY }) },
      { sectionRef: "s-game", hidden: false, value: el("БМВ коллекторов", { quantity: "1", scenes: ALL_SCENES, ...IRP_READY }) },
      { sectionRef: "s-game", hidden: false, value: el("Беспилотный трактор", { quantity: "1", scenes: ALL_SCENES, ...IRP_READY }) },
      { sectionRef: "s-game", hidden: false, value: el("Беспилотный трактор 2", { quantity: "1", scenes: "129", ...IRP_READY }) },
      { sectionRef: "s-props", hidden: false, value: el("Зонт чёрный для коллекторов", { quantity: "2", scenes: ALL_SCENES, ...IRP_READY }) },
      { sectionRef: "s-costume", hidden: false, value: el("Серый костюм водителя", { scenes: ALL_SCENES, ...IRP_READY }) },
      { sectionRef: "s-stunts", hidden: false, value: el("Трактор против БМВ", { scenes: "132", ...IRP_READY }) },
      { sectionRef: "s-stunts", hidden: false, value: el("Удар о руль", { scenes: "132", ...IRP_READY }) },
      { sectionRef: "s-camera", hidden: false, value: el("Steadicam Trinity", { scenes: "129, 132", arrivalTime: "08:00", ...IRP_READY }) },
      { sectionRef: "s-camera", hidden: false, value: el("GoPro", { quantity: "5", scenes: "129, 132", ...IRP_READY }) },
      { sectionRef: "s-cg", hidden: false, value: el("Пустая кабина", { scenes: "129, 132" }) },
      { sectionRef: "s-cg", hidden: false, value: el("Ворота на проходной 3", { scenes: "132" }) },
    ],
    manual: [
      { sectionRef: "s-group", ...el("Дублёр Вани, руки", { quantity: "1", secondUnit: true, ...IRP_READY }) },
    ],
  },
};

// ---------------------------------------------------------------------------
// Насыщенный день: 13 руководителей, 11 цехов, 8 актёров, 3 объекта, план, 2-й юнит, схема.
// ---------------------------------------------------------------------------

const FLAT: Location = {
  name: "Кухня",
  parent: { name: "Квартира Орловых" },
  address: "ул. Рубинштейна, 23, кв. 14 (вход со двора, код 2314)",
};
const YARD: Location = { name: "Двор-колодец", parent: null, address: "ул. Рубинштейна, 23" };
const EMBANKMENT: Location = {
  name: "Певческий мост",
  parent: { name: "Набережная Мойки" },
  address: "наб. реки Мойки, 20",
};

const ANNA = character("ch-anna", "Анна Орлова");
const PAVEL = character("ch-pavel", "Павел Орлов");
const VERA = character("ch-vera", "Вера Степановна");
const KIRILL = character("ch-kirill", "Кирилл");
const SLEDOV = character("ch-sledov", "Следователь Громов");
const LIZA = character("ch-liza", "Лиза (8 лет)");
const DRIVER = character("ch-driver", "Водитель «Волги»");
const WAITER = character("ch-waiter", "Официант");
const GHOST = character("ch-ghost", "Сосед снизу");

const S14 = scene("14", FLAT, {
  planSeconds: 95,
  scriptDay: 3,
  summary: "Утро. Анна находит в почте письмо без обратного адреса и прячет его от Павла.",
  characters: [ANNA, PAVEL, LIZA],
});
const S15 = scene("15", FLAT, {
  planSeconds: 140,
  scriptDay: 3,
  summary: "Ссора на кухне. Вера Степановна заступается за Анну.",
  characters: [ANNA, PAVEL, VERA],
});
const S15A = scene("15", FLAT, {
  postfix: "А",
  planSeconds: 60,
  scriptDay: 3,
  summary: "Лиза подслушивает из коридора.",
  characters: [LIZA],
});
const S16 = scene("16", FLAT, {
  planSeconds: 80,
  summary: "Сосед снизу жалуется на шум (сцена вырезана).",
  characters: [ANNA, GHOST],
  cutAt: new Date("2026-10-30T10:00:00.000Z"),
});
const S22 = scene("22", YARD, {
  intExt: "EXT",
  planSeconds: 210,
  scriptDay: 3,
  summary:
    "Кирилл ждёт Анну во дворе под дождём. Громов наблюдает из машины. Драка у арки, Кирилл падает на капот «Волги».",
  characters: [ANNA, KIRILL, SLEDOV, DRIVER],
});
const S23 = scene("23", EMBANKMENT, {
  intExt: "EXT",
  dayNight: "DUSK",
  planSeconds: 75,
  scriptDay: 3,
  summary: "Анна бросает письмо в Мойку.",
  characters: [ANNA],
});
const S31 = scene("31", EMBANKMENT, {
  intExt: "INT_EXT",
  dayNight: "DUSK",
  planSeconds: 120,
  scriptDay: 4,
  title: "Кафе на набережной",
  characters: [SLEDOV, KIRILL, WAITER],
});
const S40 = scene("40", EMBANKMENT, {
  intExt: "EXT",
  dayNight: "DUSK",
  scriptDay: 5,
  summary: "Общий план набережной с катером, без актёров.",
  characters: [],
});

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
    scenes: [S14, S15, S15A, S16, S22, S23, S31].map((s) => ({ scene: s })),
    timeSlots: [
      slot("07:00", "07:45", "MAKEUP_COSTUME"),
      slot("07:45", "08:30", "REHEARSAL", { notes: "сцены 14–15А, без грима Лизы" }),
      slot("08:30", "09:30", "SHOOTING", { scene: S14 }),
      slot("09:30", "10:45", "SHOOTING", { scene: S15, notes: "Разбиваемая тарелка — 3 дубля, не больше." }),
      slot("10:45", "11:15", "SHOOTING", { scene: S15A }),
      slot("11:15", "11:30", "SHOOTING", { scene: S16 }),
      slot("11:30", "12:00", "TRAVEL", { customLabel: "Переход во двор, свет под дождь" }),
      slot("12:00", "13:30", "SHOOTING", {
        scene: S22,
        notes: "Дождь от АЦ-40. Трюк — после брифинга каскадёров.",
      }),
      slot("13:30", "14:30", "LUNCH"),
      slot("14:30", "16:00", "SHOOTING", { scene: S22, isContinuation: true }),
      slot("16:00", "16:30", "TRAVEL"),
      slot("16:30", "17:30", "SHOOTING", { scene: S23 }),
      slot("17:30", "19:00", "SHOOTING", { scene: S31 }),
      slot("12:00", "12:45", "LUNCH", { unit: "SECOND" }),
      slot("15:00", "17:00", "SHOOTING", { unit: "SECOND", scene: S40, notes: "Катер — от причала у Певческого моста." }),
      slot("17:00", "17:30", "SHOOTING", { unit: "SECOND", customLabel: "Перебивки: мокрый асфальт, фонари" }),
    ],
    actorCalls: [
      call("a-anna", { transportMode: "CAR", carPickupTime: "05:50", arrivalTime: "06:30", makeupTime: "06:35", costumeTime: "07:20", readyTime: "07:40", wrapTime: "18:45" }),
      call("a-pavel", { transportMode: "SELF", arrivalTime: "06:45", makeupTime: "06:50", costumeTime: "07:25", readyTime: "07:45", wrapTime: "11:30" }),
      call("a-vera", { transportMode: "CAR", carPickupTime: "07:30", arrivalTime: "08:15", makeupTime: "08:20", costumeTime: "09:00", readyTime: "09:20", wrapTime: "11:30" }),
      call("a-kirill", { transportMode: "CUSTOM", transportText: "такси, чек — администратору", arrivalTime: "11:00", makeupTime: "11:05", costumeTime: "11:40", readyTime: "12:00", wrapTime: "19:00" }),
      call("a-sledov", { transportMode: "CAR", carPickupTime: "10:15", arrivalTime: "11:15", makeupTime: "11:20", costumeTime: "11:50", readyTime: "12:10", wrapTime: "19:00" }),
      call("a-liza", { transportMode: "CUSTOM", transportText: "с мамой, на своей машине", arrivalTime: "07:15", makeupTime: "07:20", costumeTime: "07:40", readyTime: "08:00", wrapTime: "11:00" }),
      call("a-driver", { transportMode: "SELF", arrivalTime: "13:00", costumeTime: "13:15", readyTime: "13:40", wrapTime: "17:30" }),
      call("a-waiter", { arrivalTime: "15:30", makeupTime: "15:35", costumeTime: "15:50", readyTime: "16:10", wrapTime: "19:00" }),
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
    tempNight: null,
    importantNote:
      "Сцена 22 — дождь от АЦ-40 с 12:00: всем цехам иметь дождевики и чехлы на технику, осветителям — укрыть приборы во дворе до начала полива.\n" +
      "Во дворе жилой дом: не шуметь до 09:00, курение только у арки, мусор не оставлять. Машины группы во двор не заезжают — парковка на ул. Правды.\n" +
      "Лиза (8 лет) на площадке не дольше 4 часов, с мамой. Сцены с ней — первыми.\n" +
      "Трюк в сцене 22 (падение на капот) — только после брифинга каскадёров и в их присутствии; посторонним в зоне трюка не находиться.",
    actorRestrictions:
      "Соколова М. — до 19:00 (спектакль). Ветров А. — только до 12:00. Петрова Е. (8 лет) — не более 4 часов на площадке, с законным представителем.",
    schemeLocation: {
      name: "Двор-колодец",
      parent: null,
      address: "ул. Рубинштейна, 23",
      directions: "От м. «Достоевская» 7 минут пешком по ул. Правды, вход во двор через арку дома 23.",
      parking: "Машины группы — на ул. Правды, нечётная сторона. Во двор не заезжать.",
      onSiteNotes: "Администратор площадки у арки с 06:00.",
      points: [
        { number: "1", name: "Арка · место сбора", description: "Автобус группы встаёт у арки в 06:15" },
        { number: "2", name: "База", description: "Грим, костюм, актёрский вагон — ул. Правды, 10" },
        { number: "3", name: "Площадка", description: "Двор-колодец, сцены 22; квартира 14 — 3 этаж" },
        { number: "4", name: "Кейтеринг", description: "Во дворе у трансформаторной будки" },
      ],
    },
    leaders: [
      ["Режиссёр-постановщик", "Лаптев Андрей", "+7 921 555-01-01"],
      ["Оператор-постановщик", "Сорокин Глеб", "+7 921 555-01-02"],
      ["Исполнительный продюсер", "Кравец Ольга", "+7 911 555-01-03"],
      ["Директор картины", "Михайлов Сергей", "+7 911 555-01-04"],
      ["Второй режиссёр", "Белова Ирина", "+7 931 555-01-05"],
      ["Второй режиссёр по площадке", "Фомин Денис", "+7 931 555-01-06"],
      ["Ассистент по актёрам", "Гаврилова Юлия", "+7 950 555-01-07"],
      ["Администратор площадки", "Ахмедов Руслан", "+7 950 555-01-08"],
      ["Художник-постановщик", "Ершов Вадим", "+7 921 555-01-09"],
      ["Художник по костюмам", "Жукова Алла", "+7 921 555-01-10"],
      ["Художник по гриму", "Олейник Светлана", "+7 911 555-01-11"],
      ["Звукорежиссёр", "Дьяконов Артём", "+7 911 555-01-12"],
      ["Каскадёр-постановщик", "Шубин Николай", "+7 999 555-01-13"],
    ].map(([position, personName, phone]) => ({
      position: position!,
      shortTitle: position === "Второй режиссёр по площадке" ? "2-й реж. по площадке" : null,
      personName: personName!,
      phone: phone!,
    })),
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
      { sectionRef: "s-group", hidden: false, value: el("Дублёр Кирилла (трюк)", { quantity: "1", scenes: "22", arrivalTime: "11:30", readyTime: "13:30", wrapTime: "16:00" }) },
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
      { sectionRef: "s-camera", hidden: false, value: el("Кран «Супертехнокран 15»", { scenes: "22", arrivalTime: "10:00", readyTime: "12:30", wrapTime: "17:30" }) },
    ],
    manual: [
      { sectionRef: "s-camera", ...el("Вторая камера (общий план набережной)", { scenes: "40", arrivalTime: "14:30", secondUnit: true }) },
      { sectionRef: "s-game", ...el("Катер прогулочный", { quantity: "1", arrivalTime: "14:30", wrapTime: "17:00", secondUnit: true }) },
      { sectionRef: "s-cg", ...el("Маркеры на окнах дома напротив", { scenes: "22", notes: "снять до 17:00" }) },
    ],
  },
};

// ---------------------------------------------------------------------------
// Минимальный день: вызывной создан, но почти пуст.
// ---------------------------------------------------------------------------

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
        scene: scene("1", { name: "Парк", parent: null, address: null }, {
          intExt: "EXT",
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
    schemeLocation: {
      name: "Парк",
      parent: null,
      address: null,
      directions: " ",
      parking: null,
      onSiteNotes: null,
      points: [],
    },
    leaders: [
      { position: "Режиссёр", shortTitle: null, personName: "Смирнова Анна", phone: null },
      { position: "Директор", shortTitle: null, personName: "Котов Пётр", phone: "+7 900 000-00-00" },
    ],
    crewCalls: [],
    baseItems: [],
  },
  elements: { sections: SECTIONS, autoRows: [], manual: [] },
};

/** Рабочий день без данных и без вызывного: только обязательные блоки, везде «не указано». */
export const EMPTY_DAY_SOURCE: CallSheetPrintSource = {
  project: { name: "Пустой день", fullName: null },
  day: {
    date: new Date("2026-11-06T00:00:00.000Z"),
    shiftNumber: null,
    isNightShift: false,
    callTime: null,
    wrapTime: null,
    shiftStartTime: null,
    rehearsalTime: null,
    motorOnTime: null,
    motorOffTime: null,
    crewMeetAddress: null,
    crewMeetTime: null,
    weatherNote: null,
    weatherPrecip: null,
    scenes: [],
    timeSlots: [],
    actorCalls: [],
    transports: [],
  },
  actors: [],
  workingDay: null,
  astro: null,
  sheet: null,
  elements: null,
};
