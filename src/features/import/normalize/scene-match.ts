import type { DayNight, IntExt, ScriptBlockType } from "@prisma/client";
import { formatHeading, parseHeading } from "@/features/import/normalize/heading";
import { cleanText, compareKey, nextSceneNumber } from "@/features/import/normalize/text";
import { blocksToScriptContent } from "@/features/screenplay/lib/block-serialization";

/**
 * Вопросы сопоставления с прошлой версией. Все разовые: код «тип:сцена:ключ».
 * Сцена — номер из файла (у «вырезать?» — номер сцены в проекте).
 */
export const SCENE_QUESTION_TYPES = {
  /** Совпала по номеру, но поменялся объект или шапка как у другой сцены. */
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

/**
 * Шапка текущей версии сценария и сцена проекта, к которой она привязана (`sceneId` блока).
 * По порядку версии; только сцены этого проекта (удалённые и чужие отброшены на сервере).
 */
export type VersionScene = {
  sceneId: string;
  /** Номер из текста шапки, как в файле прошлого импорта. */
  number: string | null;
  /** Ключ шапки без номера (`headingKey`). */
  key: string;
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
  /** Как найдена: через текущую версию, по номеру, по шапке, ответом. */
  by: "version" | "number" | "heading" | "answer" | null;
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
  versionScenes?: readonly VersionScene[];
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
 * Шапки файла ↔ шапки версии с сохранением порядка: самая длинная общая часть по ключу шапки,
 * при равенстве — больше пар с тем же номером. Сдвиг номеров и повторяющиеся шапки
 * («ИНТ. КОМНАТА» трижды) не путают сцены. Возвращает пары [индекс файла, индекс версии].
 */
function alignHeadings(
  files: readonly FileScene[],
  entries: readonly VersionScene[],
): [number, number][] {
  const n = files.length;
  const m = entries.length;
  if (n === 0 || m === 0) return [];
  const gain = (i: number, j: number) => {
    const f = files[i]!;
    const e = entries[j]!;
    if (f.key !== e.key) return 0;
    return 1000 + (f.number && e.number === compareKey(f.number) ? 1 : 0);
  };
  const w = m + 1;
  const best = new Int32Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const g = gain(i - 1, j - 1);
      best[i * w + j] = Math.max(
        best[(i - 1) * w + j]!,
        best[i * w + j - 1]!,
        g ? best[(i - 1) * w + j - 1]! + g : 0,
      );
    }
  }
  const pairs: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const g = gain(i - 1, j - 1);
    if (g && best[i * w + j] === best[(i - 1) * w + j - 1]! + g) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (best[(i - 1) * w + j] === best[i * w + j]) {
      i--;
    } else {
      j--;
    }
  }
  return pairs.reverse();
}

/**
 * Сопоставление сцен файла со сценами проекта: сначала через текущую версию сценария
 * (`sceneId` её шапок), затем по номеру сцены проекта и по шапке.
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
  const byId = new Map(scenes.map((s) => [s.id, s]));
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

  /**
   * Поменялся объект локации — номер, возможно, отдан другой сцене (решение владельца после 6а).
   * ИНТ/НАТ, подобъект и режим не считаются: объект тот же.
   */
  const objectChanged = (f: FileScene, s: ExistingScene) => {
    const objects = s.locationIds.flatMap((id) => {
      const row = locationRows.get(id);
      return row ? [compareKey(row.name)] : [];
    });
    return objects.length > 0 && f.objects.length > 0 && !f.objects.some((o) => objects.includes(o));
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

  /** Совпала по номеру: вопрос, если вырезана, сменился объект или шапка как у другой сцены. */
  const matchByNumber = (f: FileScene, candidate: ExistingScene, by: SceneMatch["by"]) => {
    const others = scenes.filter(
      (s) =>
        s.id !== candidate.id &&
        !claimed.has(s.id) &&
        !fileNumbers.has(s.number) &&
        keyOf.get(s.id) === f.key,
    );
    if (candidate.cut || others.length > 0 || objectChanged(f, candidate)) {
      confirm(f, candidate, others, by);
    } else {
      claim(f, candidate, by, false, false);
    }
  };
  const open = (f: FileScene) => !matches[f.index]!.existingId && !explicitNew.has(f.index);

  // 0. Через текущую версию: шапки файла ↔ шапки версии с сохранением порядка (на сдвиг
  // номеров не реагирует), затем по номеру как в файле. Сцена — из `sceneId` блока шапки.
  // Две шапки версии на одну сцену — сцену получает первая совпавшая, вторая идёт путём ниже.
  const versionScenes = (existing.versionScenes ?? []).filter((v) => byId.has(v.sceneId));
  for (const [fi, vi] of alignHeadings(files, versionScenes)) {
    const f = files[fi]!;
    const target = byId.get(versionScenes[vi]!.sceneId)!;
    if (claimed.has(target.id)) continue;
    if (target.cut) confirm(f, target, [], "version");
    else claim(f, target, "version", false, false);
  }
  const versionByNumber = new Map<string, VersionScene>();
  for (const v of versionScenes) {
    if (v.number && !versionByNumber.has(v.number)) versionByNumber.set(v.number, v);
  }
  for (const f of files) {
    if (!f.number || !open(f)) continue;
    const v = versionByNumber.get(compareKey(f.number));
    const candidate = v ? byId.get(v.sceneId) : undefined;
    if (!candidate || claimed.has(candidate.id)) continue;
    matchByNumber(f, candidate, "version");
  }

  // 1. По номеру сцены проекта.
  for (const f of files) {
    if (!f.number || !open(f)) continue;
    const candidate = byNumber.get(compareKey(f.number));
    if (!candidate || claimed.has(candidate.id)) continue;
    matchByNumber(f, candidate, "number");
  }

  // 2. По шапке — только однозначное совпадение с обеих сторон.
  const unmatched = () => files.filter(open);
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
