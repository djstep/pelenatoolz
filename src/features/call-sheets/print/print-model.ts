import type {
  ActorTransportMode,
  CallSheetUnit,
  DayNight,
  IntExt,
  Prisma,
  TimeSlotType,
} from "@prisma/client";
import { SPECIAL_TRANSPORT_KEY, type ElementValues } from "@/features/call-sheets/lib/sections";
import { dayNightLabels, formatSecondsMmSs, intExtLabels } from "@/shared/i18n/domain-labels";

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
  /** «вторник, 3 ноября 2026 г.» */
  dateLabel: string;
  /** «Смена 12» */
  shiftLabel: string | null;
  /** «День 12 из 40» — по рабочим дням КПП. */
  dayOfTotalLabel: string | null;
  nightShift: boolean;
  /** Только заполненные: сбор, смена, репетиция, мотор, обед, стоп, конец смены. */
  times: { label: string; value: string }[];
  crewMeetAddress: string | null;
  locations: { name: string; address: string | null }[];
  weather: {
    summary: string | null;
    tempDay: string | null;
    tempNight: string | null;
    sunrise: string | null;
    sunset: string | null;
  } | null;
  important: string | null;
  actorRestrictions: string | null;
  leaders: { position: string; name: string | null; phone: string | null }[];
  crewCalls: { label: string; time: string | null }[];
  baseItems: { name: string; time: string | null; notNeeded: boolean }[];
  cast: CallSheetPrintCastRow[];
  /** Разделы элементов площадки — только с видимыми строками; «Спецтранспорт» — свой блок. */
  elementSections: { name: string; rows: CallSheetPrintElementRow[] }[];
  specialTransport: {
    name: string;
    callTime: string | null;
    wrapTime: string | null;
    scenes: string | null;
    notes: string | null;
  }[];
  scenes: CallSheetPrintSceneRow[];
  sceneTotals: { count: number; pages: string | null; timing: string | null };
};

export type CallSheetPrintCastRow = {
  character: string;
  actor: string | null;
  scenes: string;
  /** «Машина, подача 06:30» / «Сам» / свой текст. */
  transport: string | null;
  arrival: string | null;
  makeup: string | null;
  costume: string | null;
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

export type CallSheetPrintSceneRow = {
  number: string;
  intExt: string | null;
  dayNight: string | null;
  location: string | null;
  summary: string | null;
  characters: string | null;
  pages: string | null;
  timing: string | null;
};

// ---- Что нужно на входе (подмножество данных страницы вызывного) ----

type Decimalish = number | string | Prisma.Decimal;

type PrintSourceScene = {
  number: string;
  postfix: string;
  episodeNumber: number;
  intExt: IntExt | null;
  dayNight: DayNight | null;
  title: string | null;
  summary: string | null;
  pageCount: Decimalish | null;
  planSeconds: number | null;
  cutAt: Date | string | null;
  locations: {
    location: { name: string; sublocation: string | null; address: string | null };
  }[];
  characters: { character: { id: string; name: string } }[];
};

/**
 * Данные дня для листа. По форме — подмножество `getShootDayDocument` (день КПП, сцены,
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
    scenes: { estimatedPages: Decimalish | null; scene: PrintSourceScene }[];
    timeSlots: {
      startTime: string;
      endTime: string | null;
      slotType: TimeSlotType;
      unit: CallSheetUnit;
    }[];
    actorCalls: {
      actorId: string;
      pickupTime: string | null;
      arrivalTime: string | null;
      makeupTime: string | null;
      costumeTime: string | null;
      readyTime: string | null;
      wrapTime: string | null;
      transportMode: ActorTransportMode | null;
      transportText: string | null;
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
  /** Вызывной дня; null — ещё не создан (тогда блоков из шаблона и текстов нет). */
  sheet: {
    tempDay: string | null;
    tempNight: string | null;
    importantNote: string | null;
    actorRestrictions: string | null;
    leaders: { position: string; personName: string | null; phone: string | null }[];
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

function sceneNumber(scene: Pick<PrintSourceScene, "episodeNumber" | "number" | "postfix">) {
  const ep = scene.episodeNumber > 0 ? `${scene.episodeNumber}-` : "";
  return `${ep}${scene.number}${scene.postfix || ""}`;
}

function byNumber(a: string, b: string) {
  return a.localeCompare(b, "ru", { numeric: true });
}

/** Дата дня КПП хранится полночью UTC — показываем её же, без сдвига часового пояса. */
function formatDayDate(value: Date | string) {
  return new Date(value).toLocaleDateString("ru-RU", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatPages(pages: number) {
  return pages > 0 ? pages.toFixed(2).replace(/\.?0+$/, "").replace(".", ",") : null;
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
  return [lastName, firstName].map(text).filter(Boolean).join(" ") || null;
}

function castTransport(
  call: CallSheetPrintSource["day"]["actorCalls"][number] | undefined,
): string | null {
  if (!call) return null;
  const pickup = text(call.pickupTime);
  switch (call.transportMode) {
    case "CAR":
      return pickup ? `Машина, подача ${pickup}` : "Машина";
    case "SELF":
      return "Сам";
    case "CUSTOM":
      return text(call.transportText);
    default:
      return pickup ? `Подача ${pickup}` : null;
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
        arrival: text(call?.arrivalTime),
        makeup: text(call?.makeupTime),
        costume: text(call?.costumeTime),
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

function buildElementSections(
  elements: CallSheetPrintSource["elements"],
): CallSheetPrintModel["elementSections"] {
  if (!elements) return [];
  return elements.sections
    .filter((section) => section.key !== SPECIAL_TRANSPORT_KEY)
    .map((section) => {
      const values = [
        ...elements.autoRows
          .filter((row) => row.sectionRef === section.ref && !row.hidden)
          .map((row) => row.value),
        ...elements.manual.filter((row) => row.sectionRef === section.ref),
      ];
      return {
        name: section.name,
        rows: values.map(elementRow).filter((row) => row !== null),
      };
    })
    .filter((section) => section.rows.length > 0);
}

function buildWeather(source: CallSheetPrintSource): CallSheetPrintModel["weather"] {
  const { astro, day, sheet } = source;
  const forecast = astro && !astro.weatherUnavailable ? text(astro.weatherSummary) : null;
  const precip =
    text(day.weatherPrecip) ?? (forecast && astro?.precipProb ? `осадки ${astro.precipProb}%` : null);
  const summary = [forecast ?? text(day.weatherNote), precip].filter(Boolean).join(", ") || null;
  const weather = {
    summary,
    tempDay: withDegree(text(sheet?.tempDay)) ?? (forecast ? forecastTemp(astro!.tempMax) : null),
    tempNight: withDegree(text(sheet?.tempNight)) ?? (forecast ? forecastTemp(astro!.tempMin) : null),
    sunrise: text(astro?.sunrise),
    sunset: text(astro?.sunset),
  };
  return Object.values(weather).some(Boolean) ? weather : null;
}

/** Чистая функция: данные дня и вызывного → модель листа. Вырезанные сцены не участвуют. */
export function buildCallSheetPrintModel(source: CallSheetPrintSource): CallSheetPrintModel {
  const { project, day, sheet } = source;
  const projectName = text(project.fullName) ?? project.name;
  const dayScenes = day.scenes.filter((row) => !row.scene.cutAt);
  const scenes = dayScenes.map((row) => row.scene);

  const lunch = day.timeSlots.find((slot) => slot.slotType === "LUNCH" && slot.unit === "MAIN");
  // Общее время вызова дня — за сбор, если сбор не задан, иначе за начало смены: один раз.
  const crewMeet = text(day.crewMeetTime);
  const timeEntries: [string, string | null][] = [
    ["Сбор", crewMeet ?? text(day.callTime)],
    ["Смена", text(day.shiftStartTime) ?? (crewMeet ? text(day.callTime) : null)],
    ["Репетиция", text(day.rehearsalTime)],
    ["Мотор", text(day.motorOnTime)],
    ["Обед", lunch ? [lunch.startTime, lunch.endTime].map(text).filter(Boolean).join("–") : null],
    ["Стоп", text(day.motorOffTime)],
    ["Конец смены", text(day.wrapTime)],
  ];

  const locations = new Map<string, { name: string; address: string | null }>();
  for (const scene of scenes) {
    for (const { location } of scene.locations) {
      const name = [location.name, location.sublocation].map(text).filter(Boolean).join(". ");
      const address = text(location.address);
      const key = `${name}\n${address ?? ""}`;
      if (name && !locations.has(key)) locations.set(key, { name, address });
    }
  }

  let totalPages = 0;
  let totalSeconds = 0;
  const sceneRows = dayScenes.map((row): CallSheetPrintSceneRow => {
    const scene = row.scene;
    const pages = Number(row.estimatedPages ?? scene.pageCount ?? 0);
    totalPages += pages;
    totalSeconds += scene.planSeconds ?? 0;
    const location = scene.locations[0]?.location;
    return {
      number: sceneNumber(scene),
      intExt: scene.intExt ? intExtLabels[scene.intExt] : null,
      dayNight: scene.dayNight ? dayNightLabels[scene.dayNight] : null,
      location: location
        ? [location.name, location.sublocation].map(text).filter(Boolean).join(". ") || null
        : null,
      summary: text(scene.summary) ?? text(scene.title),
      characters: scene.characters.map((c) => c.character.name).join(", ") || null,
      pages: formatPages(pages),
      timing: scene.planSeconds ? formatSecondsMmSs(scene.planSeconds) : null,
    };
  });

  const dateLabel = formatDayDate(day.date);
  const shiftLabel = day.shiftNumber ? `Смена ${day.shiftNumber}` : null;

  return {
    modelVersion: 1,
    documentTitle: ["Вызывной", projectName, dateLabel].join(" — "),
    projectName,
    dateLabel,
    shiftLabel,
    dayOfTotalLabel: source.workingDay
      ? `День ${source.workingDay.index} из ${source.workingDay.total}`
      : null,
    nightShift: day.isNightShift,
    times: timeEntries
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([label, value]) => ({ label, value })),
    crewMeetAddress: text(day.crewMeetAddress),
    locations: [...locations.values()],
    weather: buildWeather(source),
    important: text(sheet?.importantNote),
    actorRestrictions: text(sheet?.actorRestrictions),
    leaders: (sheet?.leaders ?? [])
      .filter((row) => text(row.position) || text(row.personName))
      .map((row) => ({
        position: text(row.position) ?? "",
        name: text(row.personName),
        phone: text(row.phone),
      })),
    crewCalls: (sheet?.crewCalls ?? [])
      .filter((row) => text(row.label))
      .map((row) => ({ label: text(row.label)!, time: text(row.callTime) })),
    baseItems: (sheet?.baseItems ?? [])
      .filter((row) => text(row.name))
      .map((row) => ({
        name: text(row.name)!,
        time: row.notNeeded ? null : text(row.callTime),
        notNeeded: row.notNeeded,
      })),
    cast: buildCast(source, scenes),
    elementSections: buildElementSections(source.elements),
    specialTransport: day.transports
      .filter((row) => text(row.name))
      .map((row) => ({
        name: text(row.name)!,
        callTime: text(row.callTime),
        wrapTime: text(row.wrapTime),
        scenes: text(row.scenes),
        notes: text(row.notes),
      })),
    scenes: sceneRows,
    sceneTotals: {
      count: sceneRows.length,
      pages: formatPages(totalPages),
      timing: totalSeconds > 0 ? formatSecondsMmSs(totalSeconds) : null,
    },
  };
}
