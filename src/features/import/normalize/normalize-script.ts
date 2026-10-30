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
import type { DictionaryRule } from "@/features/import/normalize/dictionary";
import {
  formatHeading,
  isNumberOnly,
  parseHeading,
  TIME_WORDS,
  type HeadingLocation,
  type ParsedHeading,
} from "@/features/import/normalize/heading";
import {
  pairKey,
  pairMembers,
  similarReason,
  type SimilarKind,
} from "@/features/import/normalize/similar";
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
 * Типы вопросов. Код постоянного вопроса — «тип:ключ», ключ из содержимого
 * (без номеров сцен и позиций), чтобы узнать отвеченный вопрос в новой версии.
 * Код разового вопроса по сцене — «тип:сцена:ключ».
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
  /** Похожие имена персонажей (в файле или с записью проекта): разные или один. */
  similarCharacters: "похожие-персонажи",
  /** Похожие объекты: разные, один объект или подобъект другого. */
  similarLocations: "похожие-локации",
  /** Имя совпало с несколькими записями проекта (старые дубли): к какой привязать. */
  recordCharacter: "запись-персонажа",
  recordLocation: "запись-локации",
} as const;

export type QuestionType = (typeof QUESTION_TYPES)[keyof typeof QUESTION_TYPES];

/**
 * Постоянные вопросы — про содержимое (имя, место, слово): ответ пойдёт в словарь проекта.
 * Остальные — разовые: только этот импорт, по каждой сцене отдельно, код с номером сцены.
 */
export const PERSISTENT_QUESTION_TYPES: ReadonlySet<QuestionType> = new Set([
  QUESTION_TYPES.notScene,
  QUESTION_TYPES.objects,
  QUESTION_TYPES.characterDigit,
  QUESTION_TYPES.latinWord,
  QUESTION_TYPES.latinInWord,
  QUESTION_TYPES.similarCharacters,
  QUESTION_TYPES.similarLocations,
  QUESTION_TYPES.recordCharacter,
  QUESTION_TYPES.recordLocation,
]);
export type QuestionGroup = "title" | "scenes" | "characters" | "locations" | "blocks";

export type NormalizeQuestion = {
  code: string;
  type: QuestionType;
  /** Нормализованный ключ из содержимого. */
  subject: string;
  group: QuestionGroup;
  /** Постоянный (в словарь) или разовый (только этот импорт). */
  persistent: boolean;
  /** У разового вопроса по сцене — номер сцены из файла, «п<порядок>» без номера, «5#2» при повторе. */
  scene: string | null;
  /** Можно ли принять в группе «Принять все». */
  acceptAll: boolean;
  /** Без ответа импортировать нельзя: предложенного ответа нет (выбор из записей проекта). */
  required: boolean;
  options: string[];
  /** Ответ, который применён, пока пользователь не ответил. */
  suggested: string;
  /** Применённый ответ: из `answers` или предложенный. */
  answer: string;
  /** Где встречается. `detail` — что предложено именно здесь (режим, номер). */
  occurrences: { paragraphIndex: number; detail?: string }[];
};

/** Ответы пользователя по коду вопроса — старше правил словаря. */
export type Answers = Readonly<Record<string, string>>;

/** Записи проекта, прочитанные до нормализации. Сама нормализация базу не читает. */
export type ExistingRecords = {
  characters: readonly { id: string; name: string }[];
  /** Строки локаций: объект (`name`) и подобъект. */
  locations: readonly { id: string; name: string; sublocation: string | null }[];
};

export type NormalizeContext = {
  dictionary?: readonly DictionaryRule[];
  existing?: ExistingRecords;
};

/** Запись проекта, к которой привязано имя. У объекта — одна из строк локации с этим именем. */
export type RecordRef = { id: string; name: string };

/** Вопрос, на который молча ответило правило словаря. */
export type AppliedRule = { code: string; type: string; subject: string; answer: string };

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
  /** Ключи имён файла, вошедших в персонажа (склейка похожих). */
  sourceKeys: string[];
  /** Привязан к существующему персонажу проекта; пусто — новый. */
  existingId: string | null;
};

export type NormalizedLocation = {
  key: string;
  object: string;
  subs: string[];
  scenes: number[];
  /** Ключи объектов файла, вошедших сюда (склейка или подобъект). */
  sourceKeys: string[];
  /** Привязан к существующему объекту проекта; пусто — новый. */
  existing: RecordRef | null;
};

export type NormalizedScript = {
  titlePage: TitlePage | null;
  blocks: NormalizedBlock[];
  scenes: NormalizedScene[];
  characters: NormalizedCharacter[];
  locations: NormalizedLocation[];
  questions: NormalizeQuestion[];
  notices: NormalizeNotice[];
  /** «Применено правил словаря: N» с раскрытием. */
  appliedRules: AppliedRule[];
  /** Цель удалена или не из этого проекта — правило не применено. */
  staleRules: DictionaryRule[];
};

const TIME_OPTIONS = Object.keys(TIME_WORDS);

type AskInput = {
  type: QuestionType;
  /** Сцена разового вопроса — входит в код. */
  scene?: string;
  subject: string;
  group: QuestionGroup;
  options: string[];
  suggested: string;
  acceptAll: boolean;
  required?: boolean;
  paragraphIndex: number;
  detail?: string;
  /** Свободный ответ, кроме вариантов (например, номер сцены). */
  valid?: (answer: string) => boolean;
};

/** Ответ на вопрос: ответ пользователя → правило словаря (только постоянные) → предложенный. */
function createQuestionBook(answers: Answers, rules: ReadonlyMap<string, DictionaryRule>) {
  const questions = new Map<string, NormalizeQuestion>();
  const applied = new Map<string, AppliedRule>();

  function applyRule(rule: DictionaryRule) {
    const code = `${rule.type}:${rule.key}`;
    applied.set(code, { code, type: rule.type, subject: rule.key, answer: rule.answer });
  }

  function ask(input: AskInput): string {
    const code =
      input.scene != null
        ? `${input.type}:${input.scene}:${input.subject}`
        : `${input.type}:${input.subject}`;
    let question = questions.get(code);
    if (!question) {
      const accepts = (answer: string | undefined): answer is string =>
        answer != null && (input.options.includes(answer) || (input.valid?.(answer) ?? false));
      const given = answers[code];
      const persistent = PERSISTENT_QUESTION_TYPES.has(input.type);
      const rule = persistent && !accepts(given) ? rules.get(code) : undefined;
      if (rule && accepts(rule.answer)) {
        // Отвечено словарём — на экран не идёт, только в «применено правил».
        applyRule(rule);
        return rule.answer;
      }
      question = {
        code,
        type: input.type,
        subject: input.subject,
        group: input.group,
        persistent,
        scene: input.scene ?? null,
        acceptAll: input.acceptAll,
        required: input.required ?? false,
        options: input.options,
        suggested: input.suggested,
        answer: accepts(given) ? given : input.suggested,
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

  return {
    ask,
    applyRule,
    /** Пользователь сам ответил на вопрос с этим кодом. */
    answered: (code: string) => answers[code] != null,
    list: () => [...questions.values()],
    applied: () => [...applied.values()],
  };
}

type QuestionBook = ReturnType<typeof createQuestionBook>;

type SceneDraft = {
  index: number;
  paragraphIndex: number;
  heading: ParsedHeading;
  /** Ключ шапки без номера — для кодов вопросов. */
  key: string;
  /** Сцена в коде разового вопроса: номер из файла, не меняется от ответов. */
  ref: string;
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
  context: NormalizeContext = {},
): NormalizedScript {
  const existing = context.existing ?? { characters: [], locations: [] };
  const dictionary = prepareDictionary(context.dictionary ?? [], existing);
  const book = createQuestionBook(answers, dictionary.byCode);
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
  const characterNames = new Map<string, NameInfo>();
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
        ref: "",
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
        scene.castLine = names.map((name) =>
          registerCharacter(characterNames, name, typed.paragraphIndex),
        );
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
      speaker = registerCharacter(characterNames, cue.name, typed.paragraphIndex);
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

  assignRefs(scenes);
  assignNumbers(scenes, book);
  resolveTimes(scenes, book);
  resolveLocations(scenes, book);
  const locations = matchLocations(scenes, existing, dictionary, book);
  const characters = matchCharacters(
    scenes,
    blocks,
    characterNames,
    speakers,
    existing,
    dictionary,
    book,
  );
  checkCastLines(scenes, book);

  for (const draft of scenes) {
    draft.block.text = formatHeading(draft.heading, draft.number, draft.tail);
  }

  return {
    titlePage,
    blocks,
    scenes: scenes.map(toScene),
    characters,
    locations,
    questions: book.list(),
    notices: [...notices].map(([code, paragraphIndexes]) => ({ code, paragraphIndexes })),
    appliedRules: book.applied(),
    staleRules: dictionary.stale,
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

/** Имя файла: как у первого появления и где оно. */
type NameInfo = { name: string; paragraphIndex: number };

function registerCharacter(names: Map<string, NameInfo>, name: string, paragraphIndex: number) {
  const key = compareKey(name);
  if (!names.has(key)) names.set(key, { name, paragraphIndex });
  return key;
}

/**
 * Сцена в коде разового вопроса — по номерам из файла, до ответов, чтобы код не менялся
 * от ответа на соседний вопрос. Без номера — «п<порядок>», повтор номера — «5#2».
 */
function assignRefs(scenes: SceneDraft[]) {
  const total = new Map<string, number>();
  for (const s of scenes) {
    if (s.number) total.set(compareKey(s.number), (total.get(compareKey(s.number)) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const s of scenes) {
    if (!s.number) {
      s.ref = `п${s.index + 1}`;
      continue;
    }
    const key = compareKey(s.number);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    s.ref = (total.get(key) ?? 0) > 1 ? `${key}#${n}` : key;
  }
}

/**
 * Номера: без номеров совсем — один вопрос «пронумеровать подряд» на файл;
 * частично — вопрос по каждой сцене без номера; повтор — вопрос по каждой сцене, кроме первой.
 */
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
        scene: s.ref,
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
    for (const s of same.slice(1)) {
      const suggestion = nextSceneNumber(number, used);
      const answer = book.ask({
        type: QUESTION_TYPES.numberDuplicate,
        scene: s.ref,
        subject: s.key,
        group: "scenes",
        options: ["keep", "suggested"],
        suggested: "keep",
        acceptAll: false,
        paragraphIndex: s.paragraphIndex,
        ...(suggestion ? { detail: suggestion } : {}),
        valid: isSceneNumber,
      });
      if (answer === "keep") continue;
      const next = answer === "suggested" ? suggestion : compareKey(answer);
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
        scene: s.ref,
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
        scene: s.ref,
        subject: s.key,
        group: "scenes",
        options: ["none", ...TIME_OPTIONS],
        suggested: "none",
        // «Принять все» — одно выбранное значение на все сцены группы.
        acceptAll: true,
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
        scene: s.ref,
        subject: key,
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

type PreparedDictionary = {
  byCode: Map<string, DictionaryRule>;
  stale: DictionaryRule[];
  /** Записи проекта по id — цели правил ищутся только здесь. */
  records: Record<SimilarKind, Map<string, RecordRef>>;
};

/** Правилу склейки, подобъекта и выбора записи нужна цель — запись этого проекта. */
function targetKind(rule: DictionaryRule): SimilarKind | null {
  switch (rule.type) {
    case QUESTION_TYPES.similarCharacters:
      return rule.answer === "different" ? null : "character";
    case QUESTION_TYPES.similarLocations:
      return rule.answer === "different" ? null : "location";
    case QUESTION_TYPES.recordCharacter:
      return "character";
    case QUESTION_TYPES.recordLocation:
      return "location";
    default:
      return null;
  }
}

/**
 * Цель правила ищется только среди записей этого проекта: удалённая или чужая цель —
 * правило устарело, не применяется, вопрос задаётся снова.
 */
function prepareDictionary(
  rules: readonly DictionaryRule[],
  existing: ExistingRecords,
): PreparedDictionary {
  const records: PreparedDictionary["records"] = {
    character: new Map(existing.characters.map((c) => [c.id, { id: c.id, name: c.name }])),
    location: new Map(existing.locations.map((l) => [l.id, { id: l.id, name: l.name }])),
  };
  const byCode = new Map<string, DictionaryRule>();
  const stale: DictionaryRule[] = [];
  for (const rule of rules) {
    const kind = targetKind(rule);
    const recordQuestion =
      rule.type === QUESTION_TYPES.recordCharacter || rule.type === QUESTION_TYPES.recordLocation;
    const valid =
      !kind ||
      (rule.target != null &&
        rule.target.kind === kind &&
        records[kind].has(rule.target.id) &&
        (!recordQuestion || rule.answer === rule.target.id));
    if (valid) byCode.set(`${rule.type}:${rule.key}`, rule);
    else stale.push(rule);
  }
  return { byCode, stale, records };
}

const NAME_QUESTIONS = {
  character: {
    similar: QUESTION_TYPES.similarCharacters,
    record: QUESTION_TYPES.recordCharacter,
    group: "characters",
  },
  location: {
    similar: QUESTION_TYPES.similarLocations,
    record: QUESTION_TYPES.recordLocation,
    group: "locations",
  },
} as const satisfies Record<
  SimilarKind,
  { similar: QuestionType; record: QuestionType; group: QuestionGroup }
>;

type NameFate =
  /** Одно лицо или один объект с другим именем файла. */
  | { kind: "same"; key: string }
  /** Подобъект другого объекта файла. */
  | { kind: "sub"; key: string }
  /** Запись проекта; `sub` — имя стало подобъектом её объекта. */
  | { kind: "record"; record: RecordRef; sub: boolean };

/** Во что превратилось имя файла. `identity` — одна запись проекта или один корень склейки. */
type ResolvedName = {
  identity: string;
  name: string;
  sub: string | null;
  record: RecordRef | null;
};

/** «same:КЛЮЧ» → ["same", "КЛЮЧ"]. */
function splitAnswer(answer: string): [string, string] {
  const at = answer.indexOf(":");
  return at < 0 ? [answer, ""] : [answer.slice(0, at), answer.slice(at + 1)];
}

/**
 * Похожие имена и записи проекта. Порядок: склейки словаря с целью → точное совпадение
 * с записью → пары внутри файла → похожие записи проекта. Всё — только предложения:
 * по умолчанию «разные». Записи проекта между собой не сравниваются и не сливаются.
 */
function matchNames(
  kind: SimilarKind,
  names: ReadonlyMap<string, NameInfo>,
  records: readonly RecordRef[],
  dictionary: PreparedDictionary,
  book: QuestionBook,
): (key: string) => ResolvedName {
  const q = NAME_QUESTIONS[kind];
  const withSub = kind === "location";
  const byKey = new Map<string, RecordRef[]>();
  for (const record of records) {
    const key = compareKey(record.name);
    byKey.set(key, [...(byKey.get(key) ?? []), record]);
  }
  const fates = new Map<string, NameFate>();

  // Старые дубли в проекте («МАМА» и «Мама»): вопрос, а не первая попавшаяся запись.
  const pickRecord = (key: string, paragraphIndex: number) => {
    const found = byKey.get(key) ?? [];
    if (found.length <= 1) return found[0] ?? null;
    const answer = book.ask({
      type: q.record,
      subject: key,
      group: q.group,
      options: found.map((r) => r.id),
      suggested: "",
      acceptAll: false,
      required: true,
      paragraphIndex,
    });
    return found.find((r) => r.id === answer) ?? null;
  };

  // 1. Склейка из словаря: имя из пары → запись, даже если второе имя в проекте переименовано.
  // Сначала роль «вошёл в другое имя»: так сохраняются цепочки (A — подобъект B, B — подобъект C).
  const asChild = new Map<string, DictionaryRule>();
  const asParent = new Map<string, DictionaryRule>();
  for (const rule of dictionary.byCode.values()) {
    if (rule.type !== q.similar || !rule.target) continue;
    if (book.answered(`${rule.type}:${rule.key}`)) continue;
    const [, parent] = splitAnswer(rule.answer);
    for (const member of pairMembers(rule.key) ?? []) {
      const roles = member === parent ? asParent : asChild;
      if (!roles.has(member)) roles.set(member, rule);
    }
  }
  for (const key of names.keys()) {
    const rule = asChild.get(key) ?? asParent.get(key);
    if (!rule?.target) continue;
    const record = dictionary.records[kind].get(rule.target.id);
    if (!record) continue;
    const [action, parent] = splitAnswer(rule.answer);
    const sub = action === "sub" && key !== parent;
    // Второе имя пары есть в файле — идём за ним; его судьбу решают его правила.
    if (key !== parent && names.has(parent)) {
      fates.set(key, { kind: sub ? "sub" : "same", key: parent });
    } else {
      fates.set(key, { kind: "record", record, sub });
    }
    book.applyRule(rule);
  }

  // 2. Точное совпадение с записью проекта — привязка без вопроса.
  const exact = new Set<string>();
  for (const [key, info] of names) {
    if (fates.has(key) || !byKey.has(key)) continue;
    exact.add(key);
    const record = pickRecord(key, info.paragraphIndex);
    if (record) fates.set(key, { kind: "record", record, sub: false });
  }

  // 3. Похожие имена внутри файла. Оба уже привязаны к записям — не спрашиваем.
  const keys = [...names.keys()];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i]!;
      const b = keys[j]!;
      if (fates.get(a)?.kind === "record" && fates.get(b)?.kind === "record") continue;
      if (!similarReason(a, b, kind)) continue;
      const options = [
        "different",
        `same:${a}`,
        `same:${b}`,
        ...(withSub ? [`sub:${a}`, `sub:${b}`] : []),
      ];
      let answer = "different";
      for (const key of [a, b]) {
        answer = book.ask({
          type: q.similar,
          subject: pairKey(a, b),
          group: q.group,
          options,
          suggested: "different",
          acceptAll: false,
          paragraphIndex: names.get(key)!.paragraphIndex,
        });
      }
      if (answer === "different") continue;
      const [action, parent] = splitAnswer(answer);
      const child = parent === a ? b : a;
      if (!fates.has(child)) {
        fates.set(child, { kind: action === "sub" ? "sub" : "same", key: parent });
      } else if (action === "same" && !fates.has(parent)) {
        // Второе имя уже привязано к записи — первое идёт за ним.
        fates.set(parent, { kind: "same", key: child });
      }
    }
  }

  // 4. Похожие записи проекта — для имён без привязки.
  for (const [key, info] of names) {
    if (fates.has(key) || exact.has(key)) continue;
    for (const recordKey of byKey.keys()) {
      if (names.has(recordKey) || !similarReason(key, recordKey, kind)) continue;
      const answer = book.ask({
        type: q.similar,
        subject: pairKey(key, recordKey),
        group: q.group,
        options: ["different", `same:${recordKey}`, ...(withSub ? [`sub:${recordKey}`] : [])],
        suggested: "different",
        acceptAll: false,
        paragraphIndex: info.paragraphIndex,
      });
      if (answer === "different") continue;
      const record = pickRecord(recordKey, info.paragraphIndex);
      if (!record) continue;
      fates.set(key, { kind: "record", record, sub: answer.startsWith("sub:") });
      break;
    }
  }

  const resolve = (key: string, seen: Set<string>): ResolvedName => {
    const own = names.get(key)?.name ?? key;
    const fate = seen.has(key) ? undefined : fates.get(key);
    seen.add(key);
    if (!fate) return { identity: key, name: own, sub: null, record: null };
    if (fate.kind === "record") {
      return {
        identity: `#${fate.record.id}`,
        name: fate.record.name,
        sub: fate.sub ? own : null,
        record: fate.record,
      };
    }
    const parent = resolve(fate.key, seen);
    if (fate.kind === "same") return parent;
    return { ...parent, sub: parent.sub ? `${parent.sub}. ${own}` : own };
  };
  return (key) => resolve(key, new Set());
}

/** Персонажи: склейка похожих, привязка к записям проекта. Ключи в сценах и репликах — новые. */
function matchCharacters(
  scenes: SceneDraft[],
  blocks: NormalizedBlock[],
  names: ReadonlyMap<string, NameInfo>,
  speakers: ReadonlySet<string>,
  existing: ExistingRecords,
  dictionary: PreparedDictionary,
  book: QuestionBook,
): NormalizedCharacter[] {
  const resolve = matchNames("character", names, existing.characters, dictionary, book);
  const groups = new Map<string, NormalizedCharacter>();
  const keyOf = new Map<string, string>();
  const usedKeys = new Set<string>();
  for (const key of names.keys()) {
    const resolved = resolve(key);
    let group = groups.get(resolved.identity);
    if (!group) {
      const base = compareKey(resolved.name);
      let groupKey = base;
      for (let n = 2; usedKeys.has(groupKey); n++) groupKey = `${base}#${n}`;
      usedKeys.add(groupKey);
      group = {
        key: groupKey,
        name: resolved.name,
        speaks: false,
        scenes: [],
        sourceKeys: [],
        existingId: resolved.record?.id ?? null,
      };
      groups.set(resolved.identity, group);
    }
    group.sourceKeys.push(key);
    if (speakers.has(key)) group.speaks = true;
    keyOf.set(key, group.key);
  }

  const mapKeys = (keys: string[]) => [...new Set(keys.map((key) => keyOf.get(key) ?? key))];
  for (const s of scenes) {
    s.speaking = mapKeys(s.speaking);
    if (s.castLine) s.castLine = mapKeys(s.castLine);
  }
  for (const b of blocks) {
    if (b.speaker) b.speaker = keyOf.get(b.speaker) ?? b.speaker;
  }

  const result = [...groups.values()];
  const byKey = new Map(result.map((c) => [c.key, c]));
  for (const s of scenes) {
    for (const key of sceneCharacters(s)) byKey.get(key)?.scenes.push(s.index);
  }
  return result;
}

/** Объекты: склейка и подобъекты похожих, привязка к объектам проекта. */
function matchLocations(
  scenes: SceneDraft[],
  existing: ExistingRecords,
  dictionary: PreparedDictionary,
  book: QuestionBook,
): NormalizedLocation[] {
  const names = new Map<string, NameInfo>();
  for (const s of scenes) {
    for (const l of s.locations) {
      const key = compareKey(l.object);
      if (!names.has(key)) names.set(key, { name: l.object, paragraphIndex: s.paragraphIndex });
    }
  }
  // Объект проекта — имя строки локации; одна строка на каждое написание имени.
  const objects = new Map<string, RecordRef>();
  for (const l of existing.locations) {
    if (!objects.has(l.name)) objects.set(l.name, { id: l.id, name: l.name });
  }
  const resolve = matchNames("location", names, [...objects.values()], dictionary, book);

  const result = new Map<string, NormalizedLocation>();
  for (const s of scenes) {
    const seen = new Set<string>();
    const locations: SceneLocation[] = [];
    for (const l of s.locations) {
      const sourceKey = compareKey(l.object);
      const resolved = resolve(sourceKey);
      const sub = resolved.sub && l.sub ? `${resolved.sub}. ${l.sub}` : (resolved.sub ?? l.sub);
      const key = compareKey(resolved.name);
      const placeKey = `${key}|${sub ? compareKey(sub) : ""}`;
      if (!seen.has(placeKey)) {
        seen.add(placeKey);
        locations.push({ object: resolved.name, sub });
      }
      const location = result.get(key) ?? {
        key,
        object: resolved.name,
        subs: [],
        scenes: [],
        sourceKeys: [],
        existing: resolved.record,
      };
      if (sub && !location.subs.some((x) => compareKey(x) === compareKey(sub))) {
        location.subs.push(sub);
      }
      if (!location.scenes.includes(s.index)) location.scenes.push(s.index);
      if (!location.sourceKeys.includes(sourceKey)) location.sourceKeys.push(sourceKey);
      location.existing ??= resolved.record;
      result.set(key, location);
    }
    s.locations = locations;
  }
  return [...result.values()];
}
