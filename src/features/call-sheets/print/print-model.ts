import type {
  ActorTransportMode,
  CallSheetUnit,
  DayNight,
  IntExt,
  TimeSlotType,
} from "@prisma/client";
import {
  DEFAULT_CALL_SHEET_SECTIONS,
  SPECIAL_TRANSPORT_KEY,
  type ElementValues,
} from "@/features/call-sheets/lib/sections";
import { SHIFT_TIMES } from "@/features/call-sheets/print/print-blocks";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import { minutesBetweenTimes } from "@/features/day-docs/lib/time-utils";
import { dayNightLabels } from "@/shared/i18n/domain-labels";

/**
 * Модель печатного листа вызывного — всё, из чего строится HTML (и позже Excel и снимок
 * утверждения). Только строки, числа, флажки и null: сериализуется в JSON как есть, без id
 * и без ссылок на базу. Пустые поля — null, пустые списки — []: шаблон их не печатает.
 * Ставки спецтранспорта (км) в модели нет вовсе.
 */
export type CallSheetPrintModel = {
  /** Версия формы модели — для старых снимков утверждения. */
  modelVersion: 1;
  documentTitle: string;
  projectName: string;
  /** «пятница, 11 сентября 2026» */
  dateLabel: string;
  /** «пт 11.09.2026» */
  shortDateLabel: string;
  /** «11.09.2026» */
  numericDate: string;
  shiftNumber: number | null;
  /** «день 12 из 40» — по рабочим дням КПП. */
  dayOfTotalLabel: string | null;
  nightShift: boolean;
  /** Сбор группы: время и место. */
  crewCall: { time: string | null; address: string | null };
  /** Полоса времён — только заполненные: смена (диапазоном), репетиция, мотор, обед, стоп-мотор. */
  times: { label: string; value: string; accent: boolean }[];
  weather: {
    summary: string | null;
    tempDay: string | null;
    tempNight: string | null;
    sunrise: string | null;
    sunset: string | null;
  } | null;
  /** Объекты дня по адресам; у объекта — номера сцен, отметка 2-го юнита. */
  locations: CallSheetPrintLocationGroup[];
  important: string | null;
  actorRestrictions: string | null;
  leaders: { position: string; name: string | null; phone: string | null }[];
  /** Цеха по строкам, порядок — из вызывного. */
  crewCalls: CallSheetPrintCrewCall[];
  baseItems: { name: string; time: string | null; notNeeded: boolean }[];
  cast: CallSheetPrintCastRow[];
  /** Групповка и дублёры — раздел «Групповка» элементов площадки. */
  groups: CallSheetPrintElementRow[];
  /** Остальные разделы элементов (со спецтранспортом) — только с видимыми строками. */
  elementSections: { name: string; rows: CallSheetPrintElementRow[] }[];
  plan: CallSheetPrintPlanRow[];
  secondUnit: { range: string | null; rows: CallSheetPrintPlanRow[] };
  scheme: CallSheetPrintScheme | null;
  totals: {
    sceneCount: number;
    /** Хронометраж всех сцен дня, «0:37». */
    dayTiming: string | null;
    /** Хронометраж сцен основного юнита в плане. */
    mainTiming: string | null;
  };
};

export type CallSheetPrintLocationGroup = {
  address: string | null;
  rows: { name: string; scenes: string | null; secondUnit: boolean }[];
};

export type CallSheetPrintCrewCall = {
  label: string;
  time: string | null;
  /** Время отличается от предыдущей строки — линия толще. */
  newTime: boolean;
  /** Самое раннее время вызова — акцентом. */
  earliest: boolean;
};

export type CallSheetPrintCastRow = {
  character: string;
  actor: string | null;
  scenes: string;
  /** car — плашка «машина», self — «сам», custom — свой текст. */
  transport: { kind: "car" | "self" | "custom"; text: string } | null;
  /** Подача машины — только у «машина». */
  carPickup: string | null;
  arrival: string | null;
  costume: string | null;
  makeup: string | null;
  ready: string | null;
  wrap: string | null;
};

export type CallSheetPrintElementRow = {
  name: string;
  quantity: string | null;
  scenes: string | null;
  arrival: string | null;
  ready: string | null;
  wrap: string | null;
  notes: string | null;
  secondUnit: boolean;
};

export type CallSheetPrintPlanRow =
  | {
      kind: "service";
      time: string | null;
      duration: string | null;
      label: string;
      note: string | null;
      lunch: boolean;
    }
  | {
      kind: "scene";
      time: string | null;
      duration: string | null;
      /** null — строка съёмки без сцены (2-й юнит). */
      sceneNumber: string | null;
      continuation: boolean;
      /** Цвет полосы и плашки: int — ИНТ, nat — НАТ и НАТ/ИНТ. */
      tone: "int" | "nat" | null;
      intExtLabel: string | null;
      title: string | null;
      /** «утро, день 10» — режим и день по сценарию. */
      mode: string | null;
      synopsis: string | null;
      elements: { label: string; value: string }[];
      note: string | null;
      characters: string | null;
      timing: string | null;
    };

export type CallSheetPrintScheme = {
  title: string;
  address: string | null;
  points: { number: string; name: string; description: string | null }[];
  directions: string | null;
  parking: string | null;
  onSite: string | null;
};

// ---- Что нужно на входе (подмножество данных страницы вызывного) ----

type PrintSourceScene = {
  number: string;
  postfix: string;
  episodeNumber: number;
  intExt: IntExt | null;
  dayNight: DayNight | null;
  scriptDay: number | null;
  title: string | null;
  summary: string | null;
  planSeconds: number | null;
  cutAt: Date | string | null;
  locations: {
    location: { name: string; sublocation: string | null; address: string | null };
  }[];
  characters: { character: { id: string; name: string } }[];
};

/**
 * Данные дня для листа. По форме — подмножество `getShootDayDocument` (день КПП, сцены, план,
 * тайминги актёров, спецтранспорт), вызывного (`getCallSheetForDay`) и элементов площадки
 * (`getCallSheetElementsEditor`), чтобы страница передавала их как есть.
 */
export type CallSheetPrintSource = {
  project: { name: string; fullName: string | null };
  day: {
    date: Date | string;
    shiftNumber: number | null;
    isNightShift: boolean;
    callTime: string | null;
    wrapTime: string | null;
    shiftStartTime: string | null;
    rehearsalTime: string | null;
    motorOnTime: string | null;
    motorOffTime: string | null;
    crewMeetAddress: string | null;
    crewMeetTime: string | null;
    weatherNote: string | null;
    weatherPrecip: string | null;
    scenes: { scene: PrintSourceScene }[];
    timeSlots: {
      startTime: string;
      endTime: string | null;
      slotType: TimeSlotType;
      unit: CallSheetUnit;
      notes: string | null;
      customLabel: string | null;
      isContinuation: boolean;
      scene: PrintSourceScene | null;
    }[];
    actorCalls: {
      actorId: string;
      arrivalTime: string | null;
      makeupTime: string | null;
      costumeTime: string | null;
      readyTime: string | null;
      wrapTime: string | null;
      transportMode: ActorTransportMode | null;
      transportText: string | null;
      carPickupTime: string | null;
    }[];
    /** Ставка км у строки может быть — в модель не берётся. */
    transports: {
      name: string;
      callTime: string | null;
      wrapTime: string | null;
      scenes: string | null;
      notes: string | null;
    }[];
  };
  actors: {
    id: string;
    characterId: string | null;
    lastName: string;
    firstName: string | null;
  }[];
  /** Порядковый номер дня среди рабочих дней КПП и их число; null — не считать. */
  workingDay: { index: number; total: number } | null;
  astro: {
    sunrise: string | null;
    sunset: string | null;
    weatherSummary: string | null;
    weatherUnavailable?: boolean;
    precipProb: number | null;
    tempMax: number | null;
    tempMin: number | null;
  } | null;
  /** Вызывной дня; null — ещё не создан (тогда блоков из шаблона, текстов и схемы нет). */
  sheet: {
    tempDay: string | null;
    tempNight: string | null;
    importantNote: string | null;
    actorRestrictions: string | null;
    schemeLocation: {
      name: string;
      sublocation: string | null;
      address: string | null;
      directions: string | null;
      parking: string | null;
      onSiteNotes: string | null;
      points: { number: string; name: string; description: string | null }[];
    } | null;
    leaders: {
      position: string;
      shortTitle: string | null;
      personName: string | null;
      phone: string | null;
    }[];
    crewCalls: { label: string; callTime: string | null }[];
    baseItems: { name: string; callTime: string | null; notNeeded: boolean }[];
  } | null;
  /** Элементы площадки вызывного (авто-строки уже без вырезанных сцен); null — нет вызывного. */
  elements: {
    sections: { ref: string; key: string | null; name: string }[];
    autoRows: { sectionRef: string; hidden: boolean; value: ElementValues }[];
    manual: ({ sectionRef: string } & ElementValues)[];
  } | null;
};

// ---- Сборка ----

/** Обрезанный текст или null, если пусто. */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function joinText(parts: (string | null | undefined)[], sep: string): string | null {
  return parts.map(text).filter(Boolean).join(sep) || null;
}

function sceneNumber(scene: Pick<PrintSourceScene, "episodeNumber" | "number" | "postfix">) {
  const ep = scene.episodeNumber > 0 ? `${scene.episodeNumber}-` : "";
  return `${ep}${scene.number}${scene.postfix || ""}`;
}

function byNumber(a: string, b: string) {
  return a.localeCompare(b, "ru", { numeric: true });
}

/** Номера сцен из текста «129, 130, 132» (как в строках элементов и спецтранспорта). */
function sceneList(value: string | null): string[] {
  return (value ?? "")
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Дата дня КПП хранится полночью UTC — показываем её же, без сдвига часового пояса. */
function formatDayDate(value: Date | string) {
  const date = new Date(value);
  const opts = { timeZone: "UTC" } as const;
  return {
    long: date
      .toLocaleDateString("ru-RU", {
        ...opts,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
      .replace(/\s*г\.$/, ""),
    weekdayShort: date.toLocaleDateString("ru-RU", { ...opts, weekday: "short" }),
    numeric: date.toLocaleDateString("ru-RU", {
      ...opts,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
  };
}

/** Хронометраж «м:сс». */
/**
 * Хронометраж «11′40″»: минуты (сколько угодно, без часов) со штрихом, секунды двумя цифрами
 * с двойным штрихом (U+2032 / U+2033) — чтобы не путать со временем суток.
 */
export function formatTiming(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}′${String(total % 60).padStart(2, "0")}″`;
}

/** Длительность строки плана «ч:мм». */
function formatDuration(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const minutes = minutesBetweenTimes(start, end);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** «+18» → «+18°»; уже со знаком градуса или словами — как есть. */
function withDegree(value: string | null) {
  if (!value) return null;
  return /\d$/.test(value) ? `${value}°` : value;
}

function forecastTemp(value: number | null) {
  if (value == null) return null;
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}°`;
}

function personName(lastName: string, firstName: string | null) {
  return joinText([lastName, firstName], " ");
}

function locationName(location: { name: string; sublocation: string | null }) {
  return joinText([location.name, location.sublocation], ". ");
}

function castTransport(
  call: CallSheetPrintSource["day"]["actorCalls"][number] | undefined,
): CallSheetPrintCastRow["transport"] {
  switch (call?.transportMode) {
    case "CAR":
      return { kind: "car", text: "машина" };
    case "SELF":
      return { kind: "self", text: "сам" };
    case "CUSTOM": {
      const custom = text(call.transportText);
      return custom ? { kind: "custom", text: custom } : null;
    }
    default:
      return null;
  }
}

function buildCast(source: CallSheetPrintSource, scenes: PrintSourceScene[]): CallSheetPrintCastRow[] {
  const byCharacter = new Map<string, { name: string; scenes: string[] }>();
  for (const scene of scenes) {
    const num = sceneNumber(scene);
    for (const link of scene.characters) {
      const entry = byCharacter.get(link.character.id);
      if (entry) {
        if (!entry.scenes.includes(num)) entry.scenes.push(num);
      } else {
        byCharacter.set(link.character.id, { name: link.character.name, scenes: [num] });
      }
    }
  }
  const actorByCharacter = new Map(
    source.actors.filter((a) => a.characterId).map((a) => [a.characterId!, a] as const),
  );
  const callByActor = new Map(source.day.actorCalls.map((c) => [c.actorId, c] as const));

  return [...byCharacter.entries()]
    .map(([characterId, entry]) => {
      const actor = actorByCharacter.get(characterId);
      const call = actor ? callByActor.get(actor.id) : undefined;
      return {
        character: entry.name,
        actor: actor ? personName(actor.lastName, actor.firstName) : null,
        scenes: entry.scenes.sort(byNumber).join(", "),
        transport: castTransport(call),
        carPickup: call?.transportMode === "CAR" ? text(call.carPickupTime) : null,
        arrival: text(call?.arrivalTime),
        costume: text(call?.costumeTime),
        makeup: text(call?.makeupTime),
        ready: text(call?.readyTime),
        wrap: text(call?.wrapTime),
      };
    })
    .sort((a, b) => a.character.localeCompare(b.character, "ru"));
}

function elementRow(value: ElementValues): CallSheetPrintElementRow | null {
  const name = text(value.name);
  if (!name) return null;
  return {
    name,
    quantity: text(value.quantity),
    scenes: text(value.scenes),
    arrival: text(value.arrivalTime),
    ready: text(value.readyTime),
    wrap: text(value.wrapTime),
    notes: text(value.notes),
    secondUnit: value.secondUnit,
  };
}

type ElementSection = { key: string | null; name: string; rows: CallSheetPrintElementRow[] };

/** Короткие подписи системных разделов в плане (если раздел не переименован). */
const PLAN_SECTION_LABELS: Record<string, string> = {
  GAME_TRANSPORT: "Транспорт",
  CAMERA: "Техника",
};

const DEFAULT_SECTION_NAMES = new Map<string, string>(
  DEFAULT_CALL_SHEET_SECTIONS.map((s) => [s.key, s.name]),
);

/**
 * Разделы элементов с видимыми строками. Спецтранспорт — из блока спецтранспорта дня
 * (только название, подача, конец, сцены, примечание) на месте своего раздела.
 */
function buildElementSections(source: CallSheetPrintSource): ElementSection[] {
  const transportRows = source.day.transports
    .filter((row) => text(row.name))
    .map(
      (row): CallSheetPrintElementRow => ({
        name: text(row.name)!,
        quantity: null,
        scenes: text(row.scenes),
        arrival: text(row.callTime),
        ready: null,
        wrap: text(row.wrapTime),
        notes: text(row.notes),
        secondUnit: false,
      }),
    );
  const elements = source.elements;
  const sections: ElementSection[] = elements
    ? elements.sections.map((section) => {
        if (section.key === SPECIAL_TRANSPORT_KEY) {
          return { key: section.key, name: section.name, rows: transportRows };
        }
        const values = [
          ...elements.autoRows
            .filter((row) => row.sectionRef === section.ref && !row.hidden)
            .map((row) => row.value),
          ...elements.manual.filter((row) => row.sectionRef === section.ref),
        ];
        return {
          key: section.key,
          name: section.name,
          rows: values.map(elementRow).filter((row) => row !== null),
        };
      })
    : [];
  if (!sections.some((s) => s.key === SPECIAL_TRANSPORT_KEY) && transportRows.length > 0) {
    sections.push({
      key: SPECIAL_TRANSPORT_KEY,
      name: DEFAULT_SECTION_NAMES.get(SPECIAL_TRANSPORT_KEY)!,
      rows: transportRows,
    });
  }
  return sections.filter((section) => section.rows.length > 0);
}

function planLabel(section: ElementSection) {
  const short = section.key ? PLAN_SECTION_LABELS[section.key] : undefined;
  return short && section.name === DEFAULT_SECTION_NAMES.get(section.key!) ? short : section.name;
}

/** «БМВ коллекторов», «Дублёр (1)», «GoPro, 5 шт». */
function elementWithQuantity(row: CallSheetPrintElementRow, group: boolean) {
  const q = row.quantity;
  if (!q || (!group && q === "1")) return row.name;
  if (group) return `${row.name} (${q})`;
  return /^\d+$/.test(q) ? `${row.name}, ${q} шт` : `${row.name}, ${q}`;
}

/**
 * Разделы, которые в плане не повторяются (решение владельца, шаг 3а): костюм, грим и
 * спецтранспорт цеха смотрят в «Элементах площадки»; в строке сцены — люди, транспорт,
 * реквизит, трюки, техника, CG и свои разделы.
 */
const PLAN_HIDDEN_SECTIONS = new Set<string>(["COSTUME", "MAKEUP", SPECIAL_TRANSPORT_KEY]);

/** Второй и дальше в перечислении — со строчной буквы, если это обычное русское слово. */
function lowerFirst(name: string) {
  return /^[А-ЯЁ][а-яё]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

/**
 * Элементы строки плана: строки разделов со сценой строки; у 2-го юнита — ещё строки
 * с отметкой «2-й юнит» без сцен.
 */
function planElements(
  sections: ElementSection[],
  scene: string | null,
  secondUnit: boolean,
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const section of sections) {
    if (section.key && PLAN_HIDDEN_SECTIONS.has(section.key)) continue;
    const group = section.key === "GROUP";
    const rows = section.rows.filter((row) => {
      const scenes = sceneList(row.scenes);
      if (scene && scenes.includes(scene)) return true;
      return secondUnit && row.secondUnit && scenes.length === 0;
    });
    if (rows.length === 0) continue;
    const value = rows
      .map((row, i) => {
        const name = elementWithQuantity(row, group);
        return i === 0 ? name : lowerFirst(name);
      })
      .join(", ");
    out.push({ label: planLabel(section), value });
  }
  return out;
}

function sceneTone(intExt: IntExt | null): "int" | "nat" | null {
  if (intExt === "INT") return "int";
  if (intExt === "EXT" || intExt === "INT_EXT") return "nat";
  return null;
}

const INT_EXT_SHORT: Record<IntExt, string> = { INT: "ИНТ", EXT: "НАТ", INT_EXT: "НАТ/ИНТ" };

function sceneMode(scene: PrintSourceScene) {
  return joinText(
    [
      scene.dayNight ? dayNightLabels[scene.dayNight].toLowerCase() : null,
      scene.scriptDay ? `день ${scene.scriptDay}` : null,
    ],
    ", ",
  );
}

type SourceSlot = CallSheetPrintSource["day"]["timeSlots"][number];

function planRow(
  slot: SourceSlot,
  sections: ElementSection[],
  secondUnit: boolean,
): CallSheetPrintPlanRow {
  const time = text(slot.startTime);
  const duration = formatDuration(time, text(slot.endTime));
  const scene = slot.scene;
  const custom = text(slot.customLabel);
  const note = text(slot.notes);
  if (slot.slotType !== "SHOOTING" && !scene) {
    return {
      kind: "service",
      time,
      duration,
      label: custom ?? timeSlotTypeLabels[slot.slotType],
      note,
      lunch: slot.slotType === "LUNCH",
    };
  }
  if (!scene) {
    return {
      kind: "scene",
      time,
      duration,
      sceneNumber: null,
      continuation: false,
      tone: null,
      intExtLabel: null,
      title: custom ?? timeSlotTypeLabels.SHOOTING,
      mode: null,
      synopsis: null,
      elements: planElements(sections, null, secondUnit),
      note,
      characters: null,
      timing: null,
    };
  }
  const num = sceneNumber(scene);
  const base = {
    kind: "scene" as const,
    time,
    duration,
    sceneNumber: num,
    tone: sceneTone(scene.intExt),
    intExtLabel: scene.intExt ? INT_EXT_SHORT[scene.intExt] : null,
  };
  if (slot.isContinuation) {
    return {
      ...base,
      continuation: true,
      title: `Продолжение сцены ${num}`,
      mode: null,
      synopsis: null,
      elements: [],
      note,
      characters: null,
      timing: null,
    };
  }
  const location = scene.locations[0]?.location;
  const title = custom ?? (location ? locationName(location) : null) ?? text(scene.title);
  const summary = text(scene.summary) ?? (title === text(scene.title) ? null : text(scene.title));
  return {
    ...base,
    continuation: false,
    title,
    mode: sceneMode(scene),
    synopsis: summary,
    elements: planElements(sections, num, secondUnit),
    note,
    characters: scene.characters.map((c) => c.character.name).join(", ") || null,
    timing: scene.planSeconds ? formatTiming(scene.planSeconds) : null,
  };
}

/**
 * Строки плана юнита; вырезанные сцены не попадают. Плана основного юнита нет вовсе —
 * сцены дня строками без времени (иначе сцены на листе не видно).
 */
function buildPlan(
  source: CallSheetPrintSource,
  unit: CallSheetUnit,
  sections: ElementSection[],
  dayScenes: PrintSourceScene[],
): CallSheetPrintPlanRow[] {
  const slots = source.day.timeSlots.filter((slot) => slot.unit === unit);
  if (unit === "MAIN" && slots.length === 0) {
    return dayScenes.map((scene) =>
      planRow(
        {
          startTime: "",
          endTime: null,
          slotType: "SHOOTING",
          unit,
          notes: null,
          customLabel: null,
          isContinuation: false,
          scene,
        },
        sections,
        false,
      ),
    );
  }
  return slots
    .filter((slot) => !slot.scene?.cutAt)
    .map((slot) => planRow(slot, sections, unit === "SECOND"));
}

/**
 * Из сводки прогноза («Пасмурно, -1…2°C, осадки 27%») — только описание неба: температура
 * на листе — своими полями «днём / ночью», осадки добавляются один раз ниже.
 */
function forecastCondition(summary: string) {
  return joinText(
    summary.split(",").filter((part) => !/°C$|^осадки\s+\d+\s*%$/i.test(part.trim())),
    ", ",
  );
}

function buildWeather(source: CallSheetPrintSource): CallSheetPrintModel["weather"] {
  const { astro, day, sheet } = source;
  const forecast = astro && !astro.weatherUnavailable ? text(astro.weatherSummary) : null;
  const precip =
    text(day.weatherPrecip) ?? (forecast && astro?.precipProb ? `осадки ${astro.precipProb}%` : null);
  const summary = joinText([(forecast && forecastCondition(forecast)) ?? text(day.weatherNote), precip], ", ");
  // t руками важнее прогноза; не заполнена — из прогноза.
  const weather = {
    summary,
    tempDay: withDegree(text(sheet?.tempDay)) ?? (forecast ? forecastTemp(astro!.tempMax) : null),
    tempNight: withDegree(text(sheet?.tempNight)) ?? (forecast ? forecastTemp(astro!.tempMin) : null),
    sunrise: text(astro?.sunrise),
    sunset: text(astro?.sunset),
  };
  return Object.values(weather).some(Boolean) ? weather : null;
}

function buildLocations(
  dayScenes: PrintSourceScene[],
  secondUnitScenes: PrintSourceScene[],
): CallSheetPrintLocationGroup[] {
  type Row = { name: string; scenes: string[]; secondUnit: boolean };
  const groups = new Map<string, { address: string | null; rows: Row[] }>();
  const rows = new Map<string, Row>();
  const add = (scene: PrintSourceScene, secondUnit: boolean) => {
    for (const { location } of scene.locations) {
      const name = locationName(location);
      if (!name) continue;
      const address = text(location.address);
      const key = `${address ?? ""}\n${name}`;
      let row = rows.get(key);
      if (!row) {
        row = { name, scenes: [], secondUnit };
        rows.set(key, row);
        const group = groups.get(address ?? "") ?? { address, rows: [] };
        group.rows.push(row);
        groups.set(address ?? "", group);
      }
      // Объект и основного, и 2-го юнита — без отметки «2-й юнит».
      if (!secondUnit) {
        row.secondUnit = false;
        const num = sceneNumber(scene);
        if (!row.scenes.includes(num)) row.scenes.push(num);
      }
    }
  };
  for (const scene of dayScenes) add(scene, false);
  for (const scene of secondUnitScenes) add(scene, true);
  return [...groups.values()].map((group) => ({
    address: group.address,
    rows: group.rows.map((row) => ({
      name: row.name,
      scenes: row.scenes.length ? `сц. ${row.scenes.sort(byNumber).join(", ")}` : null,
      secondUnit: row.secondUnit,
    })),
  }));
}

function buildCrewCalls(
  rows: NonNullable<CallSheetPrintSource["sheet"]>["crewCalls"],
): CallSheetPrintCrewCall[] {
  const list = rows
    .filter((row) => text(row.label))
    .map((row) => ({ label: text(row.label)!, time: text(row.callTime) }));
  const times = list.map((row) => row.time).filter((t): t is string => Boolean(t));
  const earliest = times.length ? [...times].sort()[0] : null;
  return list.map((row, i) => ({
    ...row,
    newTime: i > 0 && row.time !== list[i - 1]!.time,
    earliest: Boolean(earliest) && row.time === earliest,
  }));
}

function buildScheme(sheet: CallSheetPrintSource["sheet"]): CallSheetPrintScheme | null {
  const loc = sheet?.schemeLocation;
  if (!loc) return null;
  const scheme = {
    title: locationName(loc) ?? loc.name,
    address: text(loc.address),
    points: loc.points
      .filter((p) => text(p.name) || text(p.number))
      .map((p) => ({
        number: text(p.number) ?? "",
        name: text(p.name) ?? "",
        description: text(p.description),
      })),
    directions: text(loc.directions),
    parking: text(loc.parking),
    onSite: text(loc.onSiteNotes),
  };
  // Ни точек, ни текстов (карты пока нет) — листа схемы нет.
  const hasContent =
    scheme.points.length > 0 || scheme.directions || scheme.parking || scheme.onSite;
  return hasContent ? scheme : null;
}

/** Чистая функция: данные дня и вызывного → модель листа. Вырезанные сцены не участвуют. */
export function buildCallSheetPrintModel(source: CallSheetPrintSource): CallSheetPrintModel {
  const { project, day, sheet } = source;
  const projectName = text(project.fullName) ?? project.name;
  const scenes = day.scenes.map((row) => row.scene).filter((scene) => !scene.cutAt);

  const lunch = day.timeSlots.find((slot) => slot.slotType === "LUNCH" && slot.unit === "MAIN");
  const shiftStart = text(day.shiftStartTime) ?? text(day.callTime);
  const shiftEnd = text(day.wrapTime);
  const timeValues: Record<(typeof SHIFT_TIMES)[number]["label"], string | null> = {
    Смена: joinText([shiftStart, shiftEnd], "–"),
    Репетиция: text(day.rehearsalTime),
    Мотор: text(day.motorOnTime),
    Обед: lunch ? joinText([lunch.startTime, lunch.endTime], "–") : null,
    "Стоп-мотор": text(day.motorOffTime),
  };

  const sections = buildElementSections(source);
  const plan = buildPlan(source, "MAIN", sections, scenes);
  const secondUnitPlan = buildPlan(source, "SECOND", sections, scenes);
  const secondUnitScenes = day.timeSlots
    .filter((slot) => slot.unit === "SECOND" && slot.scene && !slot.scene.cutAt)
    .map((slot) => slot.scene!);

  const secondTimes = day.timeSlots
    .filter((slot) => slot.unit === "SECOND")
    .flatMap((slot) => [text(slot.startTime), text(slot.endTime)])
    .filter((t): t is string => Boolean(t))
    .sort();

  const dayTiming = scenes.reduce((sum, scene) => sum + (scene.planSeconds ?? 0), 0);
  // Хронометраж основного юнита — по сценам строк плана (продолжение — та же сцена, не второй раз).
  const secondsByNumber = new Map<string, number>();
  for (const scene of [...scenes, ...day.timeSlots.map((slot) => slot.scene)]) {
    if (scene && !scene.cutAt) secondsByNumber.set(sceneNumber(scene), scene.planSeconds ?? 0);
  }
  const mainScenes = new Set(
    plan.flatMap((row) => (row.kind === "scene" && row.sceneNumber ? [row.sceneNumber] : [])),
  );
  const mainSeconds = [...mainScenes].reduce((sum, num) => sum + (secondsByNumber.get(num) ?? 0), 0);

  const date = formatDayDate(day.date);

  return {
    modelVersion: 1,
    documentTitle: ["Вызывной", projectName, date.numeric].join(" — "),
    projectName,
    dateLabel: date.long,
    shortDateLabel: `${date.weekdayShort} ${date.numeric}`,
    numericDate: date.numeric,
    shiftNumber: day.shiftNumber ?? null,
    dayOfTotalLabel: source.workingDay
      ? `день ${source.workingDay.index} из ${source.workingDay.total}`
      : null,
    nightShift: day.isNightShift,
    crewCall: {
      time: text(day.crewMeetTime) ?? text(day.callTime),
      address: text(day.crewMeetAddress),
    },
    times: SHIFT_TIMES.flatMap(({ label, accent }) => {
      const value = timeValues[label];
      return value ? [{ label, value, accent }] : [];
    }),
    weather: buildWeather(source),
    locations: buildLocations(scenes, secondUnitScenes),
    important: text(sheet?.importantNote),
    actorRestrictions: text(sheet?.actorRestrictions),
    leaders: (sheet?.leaders ?? [])
      .filter((row) => text(row.position) || text(row.personName))
      .map((row) => ({
        position: text(row.shortTitle) ?? text(row.position) ?? "",
        name: text(row.personName),
        phone: text(row.phone),
      })),
    crewCalls: buildCrewCalls(sheet?.crewCalls ?? []),
    baseItems: (sheet?.baseItems ?? [])
      .filter((row) => text(row.name))
      .map((row) => ({
        name: text(row.name)!,
        time: row.notNeeded ? null : text(row.callTime),
        notNeeded: row.notNeeded,
      })),
    cast: buildCast(source, scenes),
    groups: sections.find((s) => s.key === "GROUP")?.rows ?? [],
    elementSections: sections
      .filter((s) => s.key !== "GROUP")
      .map(({ name, rows }) => ({ name, rows })),
    plan,
    secondUnit: {
      range: secondTimes.length
        ? joinText([secondTimes[0], secondTimes[secondTimes.length - 1]], "–")
        : null,
      rows: secondUnitPlan,
    },
    scheme: buildScheme(sheet),
    totals: {
      sceneCount: scenes.length,
      dayTiming: formatTiming(dayTiming),
      mainTiming: formatTiming(mainSeconds),
    },
  };
}
