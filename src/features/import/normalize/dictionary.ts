import {
  QUESTION_TYPES,
  type Answers,
  type NormalizedScript,
  type NormalizeQuestion,
} from "@/features/import/normalize/normalize-script";
import { pairMembers } from "@/features/import/normalize/similar";

/** Цель правила — запись проекта (персонаж или строка локации этого объекта). */
export type DictionaryTarget = { kind: "character" | "location"; id: string };

/**
 * Цель, которая создаётся этим же импортом: записи ещё нет, есть только имя.
 * При записи (шаг 6) правило получает id созданной записи в той же транзакции.
 */
export type PendingTarget = { kind: "character" | "location"; name: string };

/** Правило словаря проекта (строка таблицы `ScriptDictionaryRule`). Код вопроса — «type:key». */
export type DictionaryRule = {
  type: string;
  key: string;
  answer: string;
  target: DictionaryTarget | null;
};

export type DictionaryRuleDraft = Omit<DictionaryRule, "target"> & {
  target: DictionaryTarget | PendingTarget | null;
};

/**
 * Решения для словаря: только постоянные вопросы и только ответы пользователя
 * (в том числе «Принять все»). Ответ по умолчанию, которого не трогали, в словарь не идёт.
 * `result` — нормализация с этими же `answers`.
 */
export function rulesFromAnswers(result: NormalizedScript, answers: Answers): DictionaryRuleDraft[] {
  return result.questions
    .filter((q) => q.persistent && answers[q.code] === q.answer)
    .map((q) => ({ type: q.type, key: q.subject, answer: q.answer, target: targetOf(q, result) }));
}

function targetOf(
  q: NormalizeQuestion,
  result: NormalizedScript,
): DictionaryTarget | PendingTarget | null {
  switch (q.type) {
    case QUESTION_TYPES.recordCharacter:
      return q.answer ? { kind: "character", id: q.answer } : null;
    case QUESTION_TYPES.recordLocation:
      return q.answer ? { kind: "location", id: q.answer } : null;
    case QUESTION_TYPES.similarCharacters: {
      if (q.answer === "different") return null;
      // Склеенные имена — один персонаж: его запись или имя будущей записи.
      const members = pairMembers(q.subject) ?? [];
      const character = result.characters.find((c) =>
        members.some((key) => c.sourceKeys.includes(key)),
      );
      if (!character) return null;
      return character.existingId
        ? { kind: "character", id: character.existingId }
        : { kind: "character", name: character.name };
    }
    case QUESTION_TYPES.similarLocations: {
      if (q.answer === "different") return null;
      // «Один объект» и «подобъект другого» — цель: объект, в который вошли оба имени.
      const members = pairMembers(q.subject) ?? [];
      const location = result.locations.find((l) =>
        members.some((key) => l.sourceKeys.includes(key)),
      );
      if (!location) return null;
      return location.existing
        ? { kind: "location", id: location.existing.id }
        : { kind: "location", name: location.object };
    }
    default:
      return null;
  }
}
