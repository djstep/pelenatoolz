import type { DayNight, IntExt } from "@prisma/client";
import type {
  BlockTypingResult,
  ImportBlockType,
  TypedBlock,
} from "@/features/import/normalize/block-types";
import {
  formatCastLine,
  formatCue,
  hasTrailingDigit,
  parseCastLine,
  parseCue,
  withoutTrailingDigit,
  withSpacedDigit,
} from "@/features/import/normalize/characters";
import {
  formatHeading,
  isNumberOnly,
  parseHeading,
  TIME_WORDS,
  type HeadingLocation,
  type ParsedHeading,
} from "@/features/import/normalize/heading";
import {
  cleanText,
  compareKey,
  isLatinLookalikeWord,
  isMixedWord,
  nextSceneNumber,
  toCyrillic,
} from "@/features/import/normalize/text";
import { parseTitlePage, type TitlePage } from "@/features/import/normalize/title-page";

/**
 * Типы вопросов. Код вопроса — «тип:ключ», ключ строится из содержимого
 * (без номеров сцен и позиций), чтобы узнать отвеченный вопрос в новой версии.
 */
export const QUESTION_TYPES = {
  /** Шапка без ИНТ/НАТ или со служебным словом: сцена или примечание. */
  notScene: "шапка-не-сцена",
  timeMissing: "режим-не-указан",
  timeFromPrevious: "режим-от-предыдущей",
  /** Ни у одной сцены нет номера: пронумеровать подряд. */
  numberAll: "нумерация",
  numberMissing: "номер-не-указан",
  numberDuplicate: "номер-повтор",
  /** После « / » другой объект. */
  objects: "объекты",
  /** Цифра вплотную к имени. */
  characterDigit: "персонаж",
  /** Слово целиком из латинских двойников в имени или шапке. */
  latinWord: "латиница",
  /** Латинская буква внутри кириллического слова. */
  latinInWord: "латиница-в-слове",
  /** Говорит в сцене, но нет в строке «Персонажи». */
  castMissing: "нет-в-строке-персонажи",
  /** Уровни определения типа блока расходятся (шаг 1). */
  blockType: "тип-блока",
} as const;

export type QuestionType = (typeof QUESTION_TYPES)[keyof typeof QUESTION_TYPES];
export type QuestionGroup = "title" | "scenes" | "characters" | "locations" | "blocks";

export type NormalizeQuestion = {
  code: string;
  type: QuestionType;
  /** Нормализованный ключ из содержимого. */
  subject: string;
  group: QuestionGroup;
  /** Можно ли принять в группе «Принять все». */
  acceptAll: boolean;
  options: string[];
  /** Ответ, который применён, пока пользователь не ответил. */
  suggested: string;
  /** Применённый ответ: из `answers` или предложенный. */
  answer: string;
  /** Где встречается. `detail` — что предложено именно здесь (режим, номер). */
  occurrences: { paragraphIndex: number; detail?: string }[];
};

/** Ответы по коду вопроса. Шаг 3 будет собирать их из словаря проекта. */
export type Answers = Readonly<Record<string, string>>;

export type NormalizeNoticeCode =
  /** Пустой абзац в стиле шапки. */
  | "slugline_empty"
  /** Шапка из одного номера: «37.». */
  | "slugline_number_only"
  /** «(ДАЛЬШЕ)» и подобное на месте имени — пометка продолжения на разрыве страницы. */
  | "cue_continuation"
  /** Пустой абзац в стиле имени героя. */
  | "character_empty"
  | "slugline_autonumber_unreadable";

export type NormalizeNotice = { code: NormalizeNoticeCode; paragraphIndexes: number[] };

export type NormalizedBlock = {
  paragraphIndex: number;
  type: ImportBlockType;
  /** Текст после нормализации: только текст, без разметки. */
  text: string;
  /** Текст как в файле — для «было → стало». */
  sourceText: string;
  sceneIndex: number | null;
  /** Ключ персонажа: у имени, реплики и ремарки внутри реплики. */
  speaker: string | null;
  /** Расширения имени («ЗК», «ПРОД.») — у реплики. */
  extensions?: string[];
};

export type SceneLocation = { object: string; sub: string | null };

export type NormalizedScene = {
  index: number;
  paragraphIndex: number;
  number: string | null;
  heading: string;
  intExt: IntExt | null;
  /** Режим из словаря: «УТРО», «ВЕЧЕР». */
  time: string | null;
  /** Ближайшее значение либретто. */
  dayNight: DayNight | null;
  note: string | null;
  locations: SceneLocation[];
  /** Ключи персонажей: говорящие и из строки «Персонажи». */
  characters: string[];
  castLine: string[] | null;
};

export type NormalizedCharacter = {
  key: string;
  /** Как у первого появления в файле (в верхнем регистре). */
  name: string;
  speaks: boolean;
  scenes: number[];
};

export type NormalizedLocation = {
  key: string;
  object: string;
  subs: string[];
  scenes: number[];
};

export type NormalizedScript = {
  titlePage: TitlePage | null;
  blocks: NormalizedBlock[];
  scenes: NormalizedScene[];
  characters: NormalizedCharacter[];
  locations: NormalizedLocation[];
  questions: NormalizeQuestion[];
  notices: NormalizeNotice[];
};

const TIME_OPTIONS = Object.keys(TIME_WORDS);

type AskInput = {
  type: QuestionType;
  subject: string;
  group: QuestionGroup;
  options: string[];
  suggested: string;
  acceptAll: boolean;
  paragraphIndex: number;
  detail?: string;
  /** Свободный ответ, кроме вариантов (например, номер сцены). */
  valid?: (answer: string) => boolean;
};

function createQuestionBook(answers: Answers) {
  const questions = new Map<string, NormalizeQuestion>();

  function ask(input: AskInput): string {
    const code = `${input.type}:${input.subject}`;
    let question = questions.get(code);
    if (!question) {
      const given = answers[code];
      const ok =
        given != null && (input.options.includes(given) || (input.valid?.(given) ?? false));
      question = {
        code,
        type: input.type,
        subject: input.subject,
        group: input.group,
        acceptAll: input.acceptAll,
        options: input.options,
        suggested: input.suggested,
        answer: ok ? given : input.suggested,
        occurrences: [],
      };
      questions.set(code, question);
    }
    question.occurrences.push({
      paragraphIndex: input.paragraphIndex,
      ...(input.detail != null ? { detail: input.detail } : {}),
    });
    return question.answer;
  }

  return { ask, list: () => [...questions.values()] };
}

type QuestionBook = ReturnType<typeof createQuestionBook>;

type SceneDraft = {
  index: number;
  paragraphIndex: number;
  heading: ParsedHeading;
  /** Ключ шапки без номера — для кодов вопросов. */
  key: string;
  number: string | null;
  time: string | null;
  tail: string | null;
  locations: SceneLocation[];
  castLine: string[] | null;
  castPrefix: string | null;
  castBlock: NormalizedBlock | null;
  speaking: string[];
  block: NormalizedBlock;
};

const SCENE_NUMBER_RE = /^\d+[А-Я]?$/u;

function isSceneNumber(answer: string) {
  return SCENE_NUMBER_RE.test(compareKey(answer));
}

/** Нормализация после определения типов блоков. Чистая функция, без базы. */
export function normalizeScript(
  typing: BlockTypingResult,
  answers: Answers = {},
): NormalizedScript {
  const book = createQuestionBook(answers);
  const notices = new Map<NormalizeNoticeCode, number[]>();
  const notice = (code: NormalizeNoticeCode, paragraphIndex: number) =>
    notices.set(code, [...(notices.get(code) ?? []), paragraphIndex]);

  for (const dropped of typing.dropped) {
    if (dropped.type === "SLUGLINE") notice("slugline_empty", dropped.paragraphIndex);
    if (dropped.type === "CHARACTER") notice("character_empty", dropped.paragraphIndex);
  }
  for (const typingNotice of typing.notices) {
    for (const index of typingNotice.paragraphIndexes) notice(typingNotice.code, index);
  }

  /** Символы: пробелы, тире, латиница внутри кириллического слова. */
  const fixText = (text: string, group: QuestionGroup, paragraphIndex: number) =>
    cleanText(text).replace(/\p{L}+/gu, (word) =>
      isMixedWord(word) &&
      book.ask({
        type: QUESTION_TYPES.latinInWord,
        subject: word,
        group,
        options: ["replace", "keep"],
        suggested: "replace",
        acceptAll: true,
        paragraphIndex,
        detail: toCyrillic(word),
      }) === "replace"
        ? toCyrillic(word)
        : word,
    );

  /** Слова целиком латиницей в именах и шапках — вопрос, по умолчанию как в файле. */
  const fixLatinWords = (text: string, group: QuestionGroup, paragraphIndex: number) =>
    text.replace(/\p{L}+/gu, (word) =>
      isLatinLookalikeWord(word) &&
      book.ask({
        type: QUESTION_TYPES.latinWord,
        subject: word,
        group,
        options: ["keep", "replace"],
        suggested: "keep",
        acceptAll: false,
        paragraphIndex,
        detail: toCyrillic(word),
      }) === "replace"
        ? toCyrillic(word)
        : word,
    );

  const hasScenes = typing.blocks.some((b) => b.type === "SLUGLINE");
  const titleBlocks = hasScenes ? typing.blocks.filter((b) => b.beforeFirstScene) : [];
  const titlePage = parseTitlePage(
    titleBlocks.map((b) => fixText(b.text, "title", b.paragraphIndex)),
  );

  const conflicts = new Map(typing.conflicts.map((c) => [c.paragraphIndex, c]));
  const blocks: NormalizedBlock[] = [];
  const scenes: SceneDraft[] = [];
  const characterNames = new Map<string, string>();
  const speakers = new Set<string>();
  let scene: SceneDraft | null = null;
  let speaker: string | null = null;

  for (const typed of typing.blocks) {
    if (titleBlocks.includes(typed)) continue;
    const type = blockType(typed, conflicts.get(typed.paragraphIndex), book);
    const groupOf: QuestionGroup =
      type === "SLUGLINE" ? "scenes" : type === "CHARACTER" || type === "SCENE_CAST" ? "characters" : "blocks";
    const text = fixText(typed.text, groupOf, typed.paragraphIndex);
    const block: NormalizedBlock = {
      paragraphIndex: typed.paragraphIndex,
      type,
      text,
      sourceText: typed.text,
      sceneIndex: scene?.index ?? null,
      speaker: null,
    };

    if (type === "SLUGLINE") {
      speaker = null;
      const heading = parseHeading(text, (place) =>
        fixLatinWords(place, "scenes", typed.paragraphIndex),
      );
      if (!heading.number && typed.autoNumber?.kind === "number") {
        heading.number = String(typed.autoNumber.value);
      }
      if (isNumberOnly(heading)) {
        notice("slugline_number_only", typed.paragraphIndex);
        continue;
      }
      const key = compareKey(formatHeading(heading, null, heading.tail));
      if (!heading.intExt || heading.serviceObject) {
        const answer = book.ask({
          type: QUESTION_TYPES.notScene,
          subject: key,
          group: "scenes",
          options: ["scene", "note"],
          suggested: "scene",
          acceptAll: false,
          paragraphIndex: typed.paragraphIndex,
        });
        if (answer === "note") {
          // Не сцена — примечание на своём месте; дальше блоки идут как шли.
          blocks.push({ ...block, type: "NOTE", text: formatHeading(heading, null, heading.tail) });
          continue;
        }
      }
      scene = {
        index: scenes.length,
        paragraphIndex: typed.paragraphIndex,
        heading,
        key,
        number: heading.number,
        time: heading.time,
        tail: heading.tail,
        locations: [],
        castLine: null,
        castPrefix: null,
        castBlock: null,
        speaking: [],
        block: { ...block, sceneIndex: scenes.length },
      };
      scenes.push(scene);
      blocks.push(scene.block);
      continue;
    }

    if (type === "SCENE_CAST") {
      const cast = parseCastLine(text);
      const names = cast.names.map((name) =>
        fixLatinWords(name, "characters", typed.paragraphIndex),
      );
      block.text = formatCastLine(cast.prefix, names);
      if (scene && !scene.castBlock) {
        scene.castLine = names.map((name) => registerCharacter(characterNames, name));
        scene.castPrefix = cast.prefix;
        scene.castBlock = block;
      }
      blocks.push(block);
      continue;
    }

    if (type === "CHARACTER") {
      const cue = parseCue(text);
      if (!cue.name) {
        notice("cue_continuation", typed.paragraphIndex);
        continue;
      }
      cue.name = fixLatinWords(cue.name, "characters", typed.paragraphIndex);
      if (hasTrailingDigit(cue.name)) {
        const answer = book.ask({
          type: QUESTION_TYPES.characterDigit,
          subject: compareKey(cue.name),
          group: "characters",
          options: ["keep", "space", "typo"],
          suggested: "keep",
          acceptAll: false,
          paragraphIndex: typed.paragraphIndex,
        });
        if (answer === "space") cue.name = withSpacedDigit(cue.name);
        if (answer === "typo") cue.name = withoutTrailingDigit(cue.name);
      }
      speaker = registerCharacter(characterNames, cue.name);
      speakers.add(speaker);
      if (scene && !scene.speaking.includes(speaker)) scene.speaking.push(speaker);
      blocks.push({ ...block, text: formatCue(cue), speaker, extensions: cue.extensions });
      continue;
    }

    if (type === "DIALOGUE" || type === "PARENTHETICAL") {
      // Несколько абзацев реплики и ремарка после реплики — та же реплика.
      blocks.push({ ...block, speaker });
      continue;
    }

    speaker = null;
    blocks.push(block);
  }

  assignNumbers(scenes, book);
  resolveTimes(scenes, book);
  resolveLocations(scenes, book);
  checkCastLines(scenes, book);

  for (const draft of scenes) {
    draft.block.text = formatHeading(draft.heading, draft.number, draft.tail);
  }

  return {
    titlePage,
    blocks,
    scenes: scenes.map(toScene),
    characters: listCharacters(scenes, characterNames, speakers),
    locations: listLocations(scenes),
    questions: book.list(),
    notices: [...notices].map(([code, paragraphIndexes]) => ({ code, paragraphIndexes })),
  };
}

function blockType(
  typed: TypedBlock,
  conflict: BlockTypingResult["conflicts"][number] | undefined,
  book: QuestionBook,
): ImportBlockType {
  if (!conflict) return typed.type;
  const answer = book.ask({
    type: QUESTION_TYPES.blockType,
    subject: `${conflict.reason}:${compareKey(conflict.text)}`,
    group: "blocks",
    options: [conflict.assigned, conflict.suggested],
    suggested: conflict.assigned,
    acceptAll: false,
    paragraphIndex: conflict.paragraphIndex,
  });
  return answer as ImportBlockType;
}

function registerCharacter(names: Map<string, string>, name: string) {
  const key = compareKey(name);
  if (!names.has(key)) names.set(key, name);
  return key;
}

/** Номера: без номеров совсем — «пронумеровать подряд»; частично — по одному; повторы — вопрос. */
function assignNumbers(scenes: SceneDraft[], book: QuestionBook) {
  if (scenes.length === 0) return;

  if (scenes.every((s) => !s.number)) {
    for (const s of scenes) {
      const answer = book.ask({
        type: QUESTION_TYPES.numberAll,
        subject: "подряд",
        group: "scenes",
        options: ["number", "keep"],
        suggested: "number",
        acceptAll: false,
        paragraphIndex: s.paragraphIndex,
        detail: String(s.index + 1),
      });
      if (answer === "number") s.number = String(s.index + 1);
    }
    return;
  }

  const used = new Set(scenes.flatMap((s) => (s.number ? [compareKey(s.number)] : [])));
  let previous: string | null = null;
  for (const s of scenes) {
    if (!s.number) {
      const suggestion: string | null = previous ? nextSceneNumber(previous, used) : null;
      const answer = book.ask({
        type: QUESTION_TYPES.numberMissing,
        subject: s.key,
        group: "scenes",
        options: ["suggested", "keep"],
        suggested: "suggested",
        acceptAll: false,
        paragraphIndex: s.paragraphIndex,
        ...(suggestion ? { detail: suggestion } : {}),
        valid: isSceneNumber,
      });
      if (answer === "suggested") s.number = suggestion;
      else if (answer !== "keep") s.number = compareKey(answer);
      if (s.number) used.add(compareKey(s.number));
    }
    if (s.number) previous = s.number;
  }

  const byNumber = new Map<string, SceneDraft[]>();
  for (const s of scenes) {
    if (!s.number) continue;
    const key = compareKey(s.number);
    byNumber.set(key, [...(byNumber.get(key) ?? []), s]);
  }
  for (const [number, same] of byNumber) {
    if (same.length < 2) continue;
    let answer = "keep";
    for (const s of same) {
      answer = book.ask({
        type: QUESTION_TYPES.numberDuplicate,
        subject: number,
        group: "scenes",
        options: ["keep", "letters"],
        suggested: "keep",
        acceptAll: false,
        paragraphIndex: s.paragraphIndex,
      });
    }
    if (answer !== "letters") continue;
    for (const s of same.slice(1)) {
      const next = nextSceneNumber(number, used);
      if (!next) continue;
      s.number = next;
      used.add(next);
    }
  }
}

/** Режим: пометка вместо режима — от предыдущей шапки; нет режима — вопрос. */
function resolveTimes(scenes: SceneDraft[], book: QuestionBook) {
  let previous: string | null = null;
  for (const s of scenes) {
    const { heading } = s;
    if (!heading.time && heading.noteInsteadOfTime && previous) {
      const answer = book.ask({
        type: QUESTION_TYPES.timeFromPrevious,
        subject: s.key,
        group: "scenes",
        options: ["previous", "none", ...TIME_OPTIONS],
        suggested: "previous",
        acceptAll: true,
        paragraphIndex: s.paragraphIndex,
        detail: previous,
      });
      s.time = answer === "previous" ? previous : answer === "none" ? null : answer;
    } else if (!heading.time && heading.intExt) {
      const answer = book.ask({
        type: QUESTION_TYPES.timeMissing,
        subject: s.key,
        group: "scenes",
        options: ["none", ...TIME_OPTIONS],
        suggested: "none",
        acceptAll: false,
        paragraphIndex: s.paragraphIndex,
      });
      if (answer !== "none") {
        s.time = answer;
        if (!heading.noteInsteadOfTime) s.tail = answer;
      }
    }
    previous = s.time;
  }
}

/** Места сцены. Новый объект после « / » — вопрос: отдельный объект или подобъект первого. */
function resolveLocations(scenes: SceneDraft[], book: QuestionBook) {
  for (const s of scenes) {
    let locations: HeadingLocation[] = s.heading.locations;
    if (locations.some((l) => l.separate)) {
      const answer = book.ask({
        type: QUESTION_TYPES.objects,
        subject: compareKey(s.heading.place),
        group: "locations",
        options: ["separate", "sub"],
        suggested: "separate",
        acceptAll: false,
        paragraphIndex: s.paragraphIndex,
      });
      if (answer === "sub") {
        const first = locations[0]!;
        locations = locations.map((l) =>
          compareKey(l.object) === compareKey(first.object)
            ? l
            : { object: first.object, sub: l.sub ? `${l.object}. ${l.sub}` : l.object, separate: false },
        );
      }
    }
    const seen = new Set<string>();
    s.locations = [];
    for (const l of locations) {
      const key = `${compareKey(l.object)}|${l.sub ? compareKey(l.sub) : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      s.locations.push({ object: l.object, sub: l.sub });
    }
  }
}

/** Строка «Персонажи»: вопрос только «говорит, но нет в строке». Сцена без строки не сверяется. */
function checkCastLines(scenes: SceneDraft[], book: QuestionBook) {
  for (const s of scenes) {
    if (!s.castLine || !s.castBlock) continue;
    const missing = s.speaking.filter((key) => !s.castLine!.includes(key));
    const added: string[] = [];
    for (const key of missing) {
      const answer = book.ask({
        type: QUESTION_TYPES.castMissing,
        subject: `${s.key}:${key}`,
        group: "characters",
        options: ["keep", "add"],
        suggested: "keep",
        acceptAll: false,
        paragraphIndex: s.castBlock.paragraphIndex,
      });
      if (answer === "add") added.push(key);
    }
    if (added.length > 0) {
      const names = parseCastLine(s.castBlock.text).names;
      s.castBlock.text = formatCastLine(s.castPrefix, [...names, ...added]);
    }
  }
}

function sceneCharacters(s: SceneDraft) {
  return [...new Set([...s.speaking, ...(s.castLine ?? [])])];
}

function toScene(s: SceneDraft): NormalizedScene {
  return {
    index: s.index,
    paragraphIndex: s.paragraphIndex,
    number: s.number,
    heading: s.block.text,
    intExt: s.heading.intExt,
    time: s.time,
    dayNight: s.time ? (TIME_WORDS[s.time] ?? null) : null,
    note: s.heading.note,
    locations: s.locations,
    characters: sceneCharacters(s),
    castLine: s.castLine,
  };
}

function listCharacters(
  scenes: SceneDraft[],
  names: Map<string, string>,
  speakers: ReadonlySet<string>,
): NormalizedCharacter[] {
  const result = new Map<string, NormalizedCharacter>();
  for (const [key, name] of names) {
    result.set(key, { key, name, speaks: speakers.has(key), scenes: [] });
  }
  for (const s of scenes) {
    for (const key of sceneCharacters(s)) result.get(key)?.scenes.push(s.index);
  }
  return [...result.values()];
}

function listLocations(scenes: SceneDraft[]): NormalizedLocation[] {
  const result = new Map<string, NormalizedLocation>();
  for (const s of scenes) {
    for (const l of s.locations) {
      const key = compareKey(l.object);
      const location = result.get(key) ?? { key, object: l.object, subs: [], scenes: [] };
      if (l.sub && !location.subs.some((sub) => compareKey(sub) === compareKey(l.sub!))) {
        location.subs.push(l.sub);
      }
      if (!location.scenes.includes(s.index)) location.scenes.push(s.index);
      result.set(key, location);
    }
  }
  return [...result.values()];
}
