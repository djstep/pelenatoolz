import type { DayNight, IntExt, ScriptBlockType } from "@prisma/client";
import { formatHeading, parseHeading } from "@/features/import/normalize/heading";
import { cleanText, compareKey, nextSceneNumber } from "@/features/import/normalize/text";
import { blocksToScriptContent } from "@/features/screenplay/lib/block-serialization";

/**
 * Вопросы сопоставления с прошлой версией. Все разовые: код «тип:сцена:ключ».
 * Сцена — номер из файла (у «вырезать?» — номер сцены в проекте).
 */
export const SCENE_QUESTION_TYPES = {
  /** Совпала по номеру, но поменялись и место, и ИНТ/НАТ, или шапка как у другой сцены. */
  sameScene: "та-же-сцена",
  /** Вырезанная сцена снова в файле. */
  restoreScene: "сцена-вернуть",
  /** Сцены проекта нет в новой версии. */
  cutScene: "сцена-вырезать",
  /** Номер новой сцены занят другой сценой проекта (в том числе вырезанной) или его нет. */
  numberTaken: "номер-занят",
  /** У совпавшей сцены связь, которой нет в новой версии (решение владельца 12). */
  unlinkCharacter: "связь-персонажа",
  unlinkLocation: "связь-локации",
} as const;

/** Сцена проекта, прочитанная до нормализации. */
export type ExistingScene = {
  id: string;
  /** Номер с буквой, ключ сравнения: «11А». */
  number: string;
  /** Шапка без номера: из текущей версии сценария или собрана из полей либретто. */
  heading: string;
  intExt: IntExt | null;
  dayNight: DayNight | null;
  cut: boolean;
  characterIds: string[];
  locationIds: string[];
  /** Хэш текста сцены в либретто — понять, поменялся ли текст. */
  contentHash: string;
  /** Номера дней КПП, где стоит сцена. */
  shootDays: number[];
  /** Фактов сцены в отчётах смен. */
  reportFacts: number;
};

/** Сцена файла после нормализации — то, что нужно для сопоставления. */
export type FileScene = {
  index: number;
  paragraphIndex: number;
  /** Сцена в коде разового вопроса. */
  ref: string;
  number: string | null;
  /** Ключ шапки без номера (итоговый текст). */
  key: string;
  intExt: IntExt | null;
  /** Ключи объектов (после привязки к записям проекта). */
  objects: string[];
  places: { object: string; sub: string | null }[];
  /** Персонажи сцены, привязанные к записям проекта. */
  characterIds: string[];
  contentHash: string;
};

export type SceneMatchStatus = "unchanged" | "changed" | "new";

export type SceneMatch = {
  sceneIndex: number;
  /** Сцена проекта; пусто — новая. */
  existingId: string | null;
  /** Как найдена: по номеру, по шапке, ответом. */
  by: "number" | "heading" | "answer" | null;
  status: SceneMatchStatus;
  /** Номер в либретто: у совпавшей — её номер (импорт не перенумеровывает), у новой — новый. */
  number: string | null;
  /** Шапка в проекте до импорта. */
  previousHeading: string | null;
  headingChanged: boolean;
  /** Текст сцены поменялся — хронометраж мог устареть. */
  contentChanged: boolean;
  /** Вырезанная сцена возвращается. */
  restore: boolean;
  removeCharacterIds: string[];
  removeLocationIds: string[];
  /** Ждёт обязательного ответа. */
  pending: boolean;
};

export type MissingScene = {
  existingId: string;
  number: string;
  heading: string;
  /** Уже вырезана до импорта. */
  alreadyCut: boolean;
  /** Ответ «вырезать». */
  cut: boolean;
  shootDays: number[];
  reportFacts: number;
};

type AskInput = {
  type: string;
  scene?: string;
  subject: string;
  group: "scenes" | "characters" | "locations";
  options: string[];
  suggested: string;
  acceptAll: boolean;
  required?: boolean;
  paragraphIndex: number;
  detail?: string;
  valid?: (answer: string) => boolean;
};

type Ask = (input: AskInput) => string;

type ExistingInput = {
  scenes?: readonly ExistingScene[];
  characters: readonly { id: string; name: string }[];
  locations: readonly { id: string; name: string; sublocation: string | null }[];
};

const SCENE_NUMBER_RE = /^\d+[А-Я]?$/u;

/** Ключ шапки без номера — одинаково для файла и для проекта (там тире бывают любые). */
export function headingKey(text: string) {
  const heading = parseHeading(cleanText(text));
  return compareKey(formatHeading(heading, null, heading.tail));
}

/** FNV-1a, 32 бита: синхронно в браузере и на сервере. Не для защиты — только «поменялось ли». */
export function contentHash(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Текст сцены для либретто (`Scene.scriptContent`) — из блоков сцены без шапки. */
export function sceneContent(blocks: readonly { type: ScriptBlockType; text: string }[]) {
  return blocksToScriptContent(
    blocks.map((b, sortOrder) => ({
      id: String(sortOrder),
      type: b.type,
      content: b.text,
      sceneId: null,
      sortOrder,
    })),
  );
}

function placeKey(object: string, sub: string | null) {
  return `${compareKey(object)}|${sub ? compareKey(sub) : ""}`;
}

/** Первый свободный номер без буквы после самого большого. */
function firstFreeNumber(taken: ReadonlySet<string>) {
  let max = 0;
  for (const number of taken) max = Math.max(max, Number.parseInt(number, 10) || 0);
  return String(max + 1);
}

/**
 * Сопоставление сцен файла со сценами проекта: по номеру, затем по шапке.
 * Сцены проекта не удаляются и не перенумеровываются; статус «вырезана» и связи меняются
 * только по ответам. Чистая функция: одинаково в браузере и на сервере.
 */
export function matchScenes(
  files: readonly FileScene[],
  existing: ExistingInput,
  ask: Ask,
): { matches: SceneMatch[]; missing: MissingScene[] } {
  const scenes = existing.scenes ?? [];
  const byNumber = new Map(scenes.map((s) => [s.number, s]));
  const keyOf = new Map(scenes.map((s) => [s.id, headingKey(s.heading)]));
  const fileNumbers = new Set(files.flatMap((f) => (f.number ? [compareKey(f.number)] : [])));
  const locationRows = new Map(existing.locations.map((l) => [l.id, l]));
  const claimed = new Set<string>();
  const explicitNew = new Set<number>();

  const matches: SceneMatch[] = files.map((f) => ({
    sceneIndex: f.index,
    existingId: null,
    by: null,
    status: "new",
    number: f.number ? compareKey(f.number) : null,
    previousHeading: null,
    headingChanged: false,
    contentChanged: false,
    restore: false,
    removeCharacterIds: [],
    removeLocationIds: [],
    pending: false,
  }));

  const claim = (
    f: FileScene,
    target: ExistingScene,
    by: SceneMatch["by"],
    restore: boolean,
    pending: boolean,
  ) => {
    claimed.add(target.id);
    const match = matches[f.index]!;
    const headingChanged = keyOf.get(target.id) !== f.key;
    const contentChanged = target.contentHash !== f.contentHash;
    Object.assign(match, {
      existingId: target.id,
      by,
      number: target.number,
      previousHeading: target.heading,
      headingChanged,
      contentChanged,
      status:
        headingChanged || contentChanged || target.number !== match.number || restore
          ? "changed"
          : "unchanged",
      restore,
      pending,
    } satisfies Partial<SceneMatch>);
  };

  /** Поменялись и место, и ИНТ/НАТ — номер, скорее всего, отдан другой сцене. */
  const bothChanged = (f: FileScene, s: ExistingScene) => {
    const intExtChanged = f.intExt != null && s.intExt != null && f.intExt !== s.intExt;
    const objects = s.locationIds.flatMap((id) => {
      const row = locationRows.get(id);
      return row ? [compareKey(row.name)] : [];
    });
    const placeChanged =
      objects.length > 0 && f.objects.length > 0 && !f.objects.some((o) => objects.includes(o));
    return intExtChanged && placeChanged;
  };

  /** Вопрос «та же сцена?» или «вернуть?»: ответ — сцена проекта или «новая». */
  const confirm = (
    f: FileScene,
    candidate: ExistingScene,
    others: ExistingScene[],
    by: SceneMatch["by"],
  ) => {
    const answer = ask({
      type: candidate.cut ? SCENE_QUESTION_TYPES.restoreScene : SCENE_QUESTION_TYPES.sameScene,
      scene: f.ref,
      subject: f.key,
      group: "scenes",
      options: [candidate.cut ? "restore" : "same", ...others.map((o) => `scene:${o.id}`), "new"],
      suggested: "",
      acceptAll: false,
      required: true,
      paragraphIndex: f.paragraphIndex,
      detail: candidate.id,
    });
    if (answer === "new") {
      explicitNew.add(f.index);
      return;
    }
    if (answer.startsWith("scene:")) {
      const other = others.find((o) => `scene:${o.id}` === answer)!;
      claim(f, other, "answer", other.cut, false);
      return;
    }
    // Без ответа — показываем как совпавшую, импорт не пройдёт.
    claim(f, candidate, by, answer === "restore", answer === "");
  };

  // 1. По номеру.
  for (const f of files) {
    if (!f.number) continue;
    const candidate = byNumber.get(compareKey(f.number));
    if (!candidate || claimed.has(candidate.id)) continue;
    const others = scenes.filter(
      (s) =>
        s.id !== candidate.id &&
        !claimed.has(s.id) &&
        !fileNumbers.has(s.number) &&
        keyOf.get(s.id) === f.key,
    );
    if (candidate.cut || others.length > 0 || bothChanged(f, candidate)) {
      confirm(f, candidate, others, "number");
    } else {
      claim(f, candidate, "number", false, false);
    }
  }

  // 2. По шапке — только однозначное совпадение с обеих сторон.
  const unmatched = () =>
    files.filter((f) => !matches[f.index]!.existingId && !explicitNew.has(f.index));
  for (const f of unmatched()) {
    if (matches[f.index]!.existingId) continue;
    const candidates = scenes.filter((s) => !claimed.has(s.id) && keyOf.get(s.id) === f.key);
    const sameKey = unmatched().filter((other) => other.key === f.key);
    if (candidates.length !== 1 || sameKey.length !== 1) continue;
    const candidate = candidates[0]!;
    if (candidate.cut) confirm(f, candidate, [], "heading");
    else claim(f, candidate, "heading", false, false);
  }

  // 3. Номера новых сцен: занят любой сценой проекта (в том числе вырезанной), другой сценой
  // файла или номера нет — вопрос. Предложение не берёт номера, которые есть в файле.
  const taken = new Set(scenes.map((s) => s.number));
  const reserved = new Set([...taken, ...fileNumbers]);
  let previous: string | null = null;
  for (const f of files) {
    const match = matches[f.index]!;
    if (match.existingId) {
      previous = match.number;
      continue;
    }
    let number = match.number;
    if (!number || taken.has(number)) {
      const suggestion = previous
        ? nextSceneNumber(previous, reserved)
        : number
          ? nextSceneNumber(number, reserved)
          : firstFreeNumber(reserved);
      const answer = ask({
        type: SCENE_QUESTION_TYPES.numberTaken,
        scene: f.ref,
        subject: f.key,
        group: "scenes",
        options: ["suggested"],
        suggested: "suggested",
        acceptAll: false,
        paragraphIndex: f.paragraphIndex,
        ...(suggestion ? { detail: suggestion } : {}),
        valid: (value) => {
          const key = compareKey(value);
          return SCENE_NUMBER_RE.test(key) && !reserved.has(key);
        },
      });
      number = answer === "suggested" ? suggestion : compareKey(answer);
      match.pending = !number;
    }
    match.number = number;
    if (number) {
      taken.add(number);
      reserved.add(number);
      previous = number;
    }
  }

  // 4. Сцены проекта, которых нет в новой версии.
  const missing: MissingScene[] = [];
  for (const s of scenes) {
    if (claimed.has(s.id)) continue;
    let cut = false;
    if (!s.cut) {
      cut =
        ask({
          type: SCENE_QUESTION_TYPES.cutScene,
          scene: s.number,
          subject: keyOf.get(s.id) || s.number,
          group: "scenes",
          options: ["keep", "cut"],
          suggested: "keep",
          acceptAll: false,
          paragraphIndex: -1,
          detail: s.id,
        }) === "cut";
    }
    missing.push({
      existingId: s.id,
      number: s.number,
      heading: s.heading,
      alreadyCut: s.cut,
      cut,
      shootDays: s.shootDays,
      reportFacts: s.reportFacts,
    });
  }

  // 5. Связи совпавших сцен: новые добавляются, пропавшие — вопрос «убрать связь?».
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const characterNames = new Map(existing.characters.map((c) => [c.id, c.name]));
  for (const f of files) {
    const match = matches[f.index]!;
    const target = match.existingId ? byId.get(match.existingId) : undefined;
    if (!target || match.pending) continue;
    for (const id of target.characterIds) {
      if (f.characterIds.includes(id)) continue;
      const name = characterNames.get(id);
      if (!name) continue;
      const answer = ask({
        type: SCENE_QUESTION_TYPES.unlinkCharacter,
        scene: f.ref,
        subject: compareKey(name),
        group: "characters",
        options: ["keep", "remove"],
        suggested: "keep",
        acceptAll: false,
        paragraphIndex: f.paragraphIndex,
      });
      if (answer === "remove") match.removeCharacterIds.push(id);
    }
    const filePlaces = new Set(f.places.map((p) => placeKey(p.object, p.sub)));
    for (const id of target.locationIds) {
      const row = locationRows.get(id);
      if (!row || filePlaces.has(placeKey(row.name, row.sublocation))) continue;
      const answer = ask({
        type: SCENE_QUESTION_TYPES.unlinkLocation,
        scene: f.ref,
        subject: compareKey(row.sublocation ? `${row.name}. ${row.sublocation}` : row.name),
        group: "locations",
        options: ["keep", "remove"],
        suggested: "keep",
        acceptAll: false,
        paragraphIndex: f.paragraphIndex,
      });
      if (answer === "remove") match.removeLocationIds.push(id);
    }
  }

  return { matches, missing };
}
