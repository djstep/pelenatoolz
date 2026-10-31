import {
  QUESTION_TYPES,
  type ExistingRecords,
  type NormalizeNoticeCode,
  type NormalizeQuestion,
  type QuestionGroup,
} from "@/features/import/normalize/normalize-script";
import { pairMembers } from "@/features/import/normalize/similar";
import { SCRIPT_BLOCK_LABELS } from "@/features/screenplay/lib/block-types";
import type { ScriptBlockType } from "@prisma/client";

export const GROUP_TITLES: Record<QuestionGroup, string> = {
  title: "Титульная страница",
  scenes: "Сцены",
  characters: "Персонажи",
  locations: "Локации",
  blocks: "Нераспознанные блоки",
};

export const NOTICE_TEXT: Record<NormalizeNoticeCode, string> = {
  slugline_empty: "Пустые абзацы в стиле шапки — выброшены",
  slugline_number_only: "Шапки из одного номера («37.») — выброшены",
  cue_continuation: "«(ДАЛЬШЕ)» и подобное на месте имени — не персонаж, выброшено",
  character_empty: "Пустые абзацы в стиле имени героя — выброшены",
  slugline_autonumber_unreadable: "Автонумерация Word у шапок не прочитана — номера не взяты",
};

/** «same:КЛЮЧ» → ["same", "КЛЮЧ"]. */
function split(option: string): [string, string] {
  const at = option.indexOf(":");
  return at < 0 ? [option, ""] : [option.slice(0, at), option.slice(at + 1)];
}

function sceneRef(q: NormalizeQuestion) {
  return q.scene ? `Сцена ${q.scene.replace(/^п(\d+)$/, "№ п/п $1")}` : "Сцена";
}

/** Текст абзаца из кода вопроса «тип блока»: «причина:ТЕКСТ». */
function blockText(subject: string) {
  return split(subject)[1];
}

/** Где используется сцена проекта: дни КПП и отчёты смен. */
export function sceneUsage(scene: { shootDays: number[]; reportFacts: number }) {
  const parts = [
    scene.shootDays.length > 0 ? `в КПП: дни ${scene.shootDays.join(", ")}` : null,
    scene.reportFacts > 0 ? `в отчётах смен: ${scene.reportFacts}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : " · в КПП и отчётах не используется";
}

/** Сцена проекта из `detail` вопроса сопоставления (там её id). */
function projectScene(q: NormalizeQuestion, existing: ExistingRecords | undefined) {
  const id = q.occurrences.find((o) => o.detail)?.detail;
  return existing?.scenes?.find((s) => s.id === id) ?? null;
}

export function questionTitle(q: NormalizeQuestion, existing?: ExistingRecords): string {
  const [a, b] = pairMembers(q.subject) ?? [q.subject, ""];
  switch (q.type) {
    case QUESTION_TYPES.sameScene: {
      const scene = projectScene(q, existing);
      return `${sceneRef(q)} «${q.subject}»: та же сцена, что сцена ${scene?.number ?? "?"} проекта («${scene?.heading ?? ""}»)?`;
    }
    case QUESTION_TYPES.restoreScene: {
      const scene = projectScene(q, existing);
      return `${sceneRef(q)} «${q.subject}»: сцена ${scene?.number ?? "?"} проекта вырезана — вернуть?`;
    }
    case QUESTION_TYPES.cutScene: {
      const scene = projectScene(q, existing);
      return `Сцены ${q.scene} «${scene?.heading ?? q.subject}» нет в новой версии — пометить вырезанной?${scene ? sceneUsage(scene) : ""}`;
    }
    case QUESTION_TYPES.numberTaken:
      return /^п\d+$/.test(q.scene ?? "")
        ? `${sceneRef(q)} «${q.subject}»: новая сцена без номера — какой номер дать в либретто?`
        : `${sceneRef(q)} «${q.subject}»: номер уже занят в проекте — какой номер дать новой сцене?`;
    case QUESTION_TYPES.unlinkCharacter:
      return `${sceneRef(q)}: персонаж ${q.subject} есть в либретто, но нет в новой версии — убрать связь?`;
    case QUESTION_TYPES.unlinkLocation:
      return `${sceneRef(q)}: локация «${q.subject}» есть в либретто, но нет в новой версии — убрать связь?`;
    case QUESTION_TYPES.notScene:
      return `Шапка «${q.subject}» — сцена или примечание?`;
    case QUESTION_TYPES.timeMissing:
      return `${sceneRef(q)} «${q.subject}»: режим не указан`;
    case QUESTION_TYPES.timeFromPrevious:
      return `${sceneRef(q)} «${q.subject}»: вместо режима пометка — взять режим предыдущей сцены?`;
    case QUESTION_TYPES.numberAll:
      return "Ни у одной сцены нет номера";
    case QUESTION_TYPES.numberMissing:
      return `Сцена без номера: «${q.subject}»`;
    case QUESTION_TYPES.numberDuplicate:
      return `Номер повторяется: ${sceneRef(q).toLowerCase()} «${q.subject}»`;
    case QUESTION_TYPES.objects:
      return `«${q.subject}» — после « / » другой объект`;
    case QUESTION_TYPES.characterDigit:
      return `Имя с цифрой: «${q.subject}»`;
    case QUESTION_TYPES.latinWord:
      return `Слово латиницей: «${q.subject}»`;
    case QUESTION_TYPES.latinInWord:
      return `Латинская буква в слове «${q.subject}»`;
    case QUESTION_TYPES.castMissing:
      return `${sceneRef(q)}: ${q.subject} говорит, но нет в строке «Персонажи»`;
    case QUESTION_TYPES.blockType:
      return `Тип абзаца под вопросом: «${blockText(q.subject)}»`;
    case QUESTION_TYPES.similarCharacters:
    case QUESTION_TYPES.similarLocations:
      return `Похожие названия: «${a}» и «${b}»`;
    case QUESTION_TYPES.recordCharacter:
      return `«${q.subject}» совпало с несколькими персонажами проекта — к какому привязать?`;
    case QUESTION_TYPES.recordLocation:
      return `«${q.subject}» совпало с несколькими объектами проекта — к какому привязать?`;
    case QUESTION_TYPES.timing: {
      const [before, after] = (q.occurrences.find((o) => o.detail)?.detail ?? "").split(" → ");
      return `${sceneRef(q)} «${q.subject}»: текст изменился — хронометраж в либретто ${before ?? "—"}, по новому тексту ${after ?? "—"}`;
    }
    default:
      return q.code;
  }
}

/** Подпись варианта ответа. `fileKeys` — имена из файла: остальные — записи проекта. */
export function optionLabel(
  q: NormalizeQuestion,
  option: string,
  existing: ExistingRecords,
  fileKeys: ReadonlySet<string>,
  /** Синхронизация с либретто: «без режима» значит «режим в либретто не менять». */
  sync = false,
): string {
  const detail = q.occurrences.find((o) => o.detail)?.detail;
  const [action, name] = split(option);
  if (
    sync &&
    option === "none" &&
    (q.type === QUESTION_TYPES.timeMissing || q.type === QUESTION_TYPES.timeFromPrevious)
  ) {
    return "Не менять режим в либретто";
  }
  switch (q.type) {
    case QUESTION_TYPES.sameScene:
    case QUESTION_TYPES.restoreScene: {
      if (option === "new") return "Нет, это новая сцена";
      const scene =
        action === "scene"
          ? existing.scenes?.find((s) => s.id === name)
          : projectScene(q, existing);
      const label = `сцена ${scene?.number ?? "?"} проекта`;
      if (option === "restore") return `Вернуть: это ${label}`;
      if (option === "same") return `Да, это ${label}`;
      return `Это ${label} «${scene?.heading ?? ""}»${scene?.cut ? " (вырезана — вернётся)" : ""}`;
    }
    case QUESTION_TYPES.cutScene:
      return option === "cut" ? "Пометить вырезанной" : "Оставить как есть";
    case QUESTION_TYPES.timing: {
      const [before, after] = (detail ?? "").split(" → ");
      return option === "recalc" ? `Пересчитать: ${after ?? "—"}` : `Оставить ${before ?? "—"}`;
    }
    case QUESTION_TYPES.numberTaken:
      return `Номер ${detail ?? "—"}`;
    case QUESTION_TYPES.unlinkCharacter:
    case QUESTION_TYPES.unlinkLocation:
      return option === "remove" ? "Убрать связь" : "Оставить";
    case QUESTION_TYPES.notScene:
      return option === "scene" ? "Сцена" : "Примечание, не сцена";
    case QUESTION_TYPES.timeMissing:
      return option === "none" ? "Без режима" : option;
    case QUESTION_TYPES.timeFromPrevious:
      if (option === "previous") return `Как у предыдущей: ${detail ?? "—"}`;
      return option === "none" ? "Без режима" : option;
    case QUESTION_TYPES.numberAll:
      return option === "number" ? "Пронумеровать подряд" : "Оставить без номеров";
    case QUESTION_TYPES.numberMissing:
      return option === "suggested" ? `Номер ${detail ?? "—"}` : "Без номера";
    case QUESTION_TYPES.numberDuplicate:
      return option === "keep" ? "Оставить как в файле" : `Номер ${detail ?? "—"}`;
    case QUESTION_TYPES.objects:
      return option === "separate" ? "Отдельные объекты" : "Подобъекты первого объекта";
    case QUESTION_TYPES.characterDigit:
      if (option === "keep") return `Оставить «${q.subject}»`;
      if (option === "space") return `«${q.subject.replace(/(\p{L})(\d+)$/u, "$1 $2")}»`;
      return `Опечатка: «${q.subject.replace(/\d+$/, "").trim()}»`;
    case QUESTION_TYPES.latinWord:
      return option === "keep" ? "Оставить латиницей" : `Заменить на «${detail ?? ""}»`;
    case QUESTION_TYPES.latinInWord:
      return option === "replace" ? `Исправить на «${detail ?? ""}»` : "Оставить как есть";
    case QUESTION_TYPES.castMissing:
      return option === "add" ? "Добавить в строку «Персонажи»" : "Не добавлять";
    case QUESTION_TYPES.blockType:
      return SCRIPT_BLOCK_LABELS[option as ScriptBlockType] ?? option;
    case QUESTION_TYPES.similarCharacters:
      if (action === "different") return "Разные персонажи";
      return fileKeys.has(name)
        ? `Один персонаж: «${name}»`
        : `Это «${name}» из проекта — привязать`;
    case QUESTION_TYPES.similarLocations: {
      if (action === "different") return "Разные объекты";
      const inProject = fileKeys.has(name) ? "" : " (есть в проекте)";
      return action === "same"
        ? `Один объект: «${name}»${inProject}`
        : `Подобъект «${name}»${inProject}`;
    }
    case QUESTION_TYPES.recordCharacter: {
      const found = existing.characters.find((c) => c.id === option);
      return found ? `«${found.name}»` : option;
    }
    case QUESTION_TYPES.recordLocation: {
      const rows = existing.locations.filter((l) => l.id === option);
      return rows[0] ? `«${rows[0].name}»` : option;
    }
    default:
      return option;
  }
}

const RULE_TYPE_TITLES: Record<string, string> = {
  [QUESTION_TYPES.notScene]: "Шапка",
  [QUESTION_TYPES.objects]: "Два объекта",
  [QUESTION_TYPES.characterDigit]: "Имя с цифрой",
  [QUESTION_TYPES.latinWord]: "Слово латиницей",
  [QUESTION_TYPES.latinInWord]: "Латиница в слове",
  [QUESTION_TYPES.similarCharacters]: "Похожие персонажи",
  [QUESTION_TYPES.similarLocations]: "Похожие объекты",
  [QUESTION_TYPES.recordCharacter]: "Персонаж проекта",
  [QUESTION_TYPES.recordLocation]: "Объект проекта",
};

const RULE_ANSWERS: Record<string, string> = {
  different: "разные",
  note: "примечание, не сцена",
  scene: "сцена",
  keep: "оставить как есть",
  replace: "заменить кириллицей",
  space: "число через пробел",
  typo: "опечатка, без цифры",
  separate: "отдельные объекты",
  sub: "подобъекты первого",
};

/** Строка правила словаря: «Похожие персонажи: МАРИЯ|МАРИНА → разные». */
export function ruleText(
  rule: { type: string; subject: string; answer: string },
  existing: ExistingRecords,
): string {
  const [action, name] = split(rule.answer);
  let answer = RULE_ANSWERS[rule.answer];
  if (!answer && action === "same") answer = `одно: «${name}»`;
  if (!answer && action === "sub") answer = `подобъект «${name}»`;
  if (!answer) {
    const record =
      existing.characters.find((c) => c.id === rule.answer) ??
      existing.locations.find((l) => l.id === rule.answer);
    answer = record ? `запись «${record.name}»` : rule.answer;
  }
  const subject = (pairMembers(rule.subject) ?? [rule.subject]).join(" ~ ");
  return `${RULE_TYPE_TITLES[rule.type] ?? rule.type}: ${subject} → ${answer}`;
}

/**
 * Варианты на экране. У режима — только русские слова: английские (DAY, NIGHT) остаются
 * допустимыми ответами нормализации, но в списке дублировали бы русские.
 */
export function visibleOptions(q: NormalizeQuestion): string[] {
  if (q.type !== QUESTION_TYPES.timeMissing && q.type !== QUESTION_TYPES.timeFromPrevious) {
    return q.options;
  }
  return q.options.filter((option) => !/^[A-Z]+$/.test(option) || option === q.answer);
}

/** Вопросы с номером сцены — можно ввести свой номер. */
export function acceptsCustomNumber(q: NormalizeQuestion) {
  return (
    q.type === QUESTION_TYPES.numberMissing ||
    q.type === QUESTION_TYPES.numberDuplicate ||
    q.type === QUESTION_TYPES.numberTaken
  );
}
