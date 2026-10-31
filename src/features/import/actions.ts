"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { classifyParagraphs, type BlockTypingResult } from "@/features/import/normalize/block-types";
import { readDocxParagraphs } from "@/features/import/normalize/docx-paragraphs";
import {
  isDocxReadError,
  SCRIPT_DOCUMENT_XML_MAX_BYTES,
  type DocxReadErrorCode,
} from "@/features/import/normalize/docx-zip";
import {
  normalizeScript,
  type NormalizedScript,
} from "@/features/import/normalize/normalize-script";
import { loadImportContext } from "@/features/import/review/load-context";
import {
  formatMegabytes,
  SCRIPT_IMPORT_MAX_BYTES,
  type ScriptImportState,
  type ScriptPreviewState,
} from "@/features/import/review/types";
import {
  isScriptVersionConflictError,
  VersionBlocksChangedError,
  writeScript,
  type ScriptWriteInput,
  type ScriptWriteResult,
} from "@/features/import/write/apply";
import { blockingQuestions, planImport } from "@/features/import/write/plan";
import { loadVersionSource } from "@/features/import/write/version-source";
import { typingFromVersionBlocks } from "@/features/import/write/version-typing";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";

const DOCX_ERRORS: Record<DocxReadErrorCode, string> = {
  not_zip: "Это не файл Word (.docx). Сохраните сценарий в Word как .docx и загрузите снова.",
  not_docx: "Это не документ Word (.docx). Сохраните сценарий в Word как .docx и загрузите снова.",
  too_many_files: "Файл .docx устроен необычно: слишком много частей внутри. Пересохраните его в Word.",
  too_large: "Файл .docx после распаковки слишком большой. Уберите из него картинки или разделите сценарий.",
  unsupported: "Файл .docx сжат неподдерживаемым способом. Пересохраните его в Word.",
  script_too_large: `Сценарий слишком большой для импорта: текст документа больше ${SCRIPT_DOCUMENT_XML_MAX_BYTES / (1024 * 1024)} МБ. Разделите сценарий на части.`,
};

const NO_RIGHTS = "Импорт сценария доступен только с правом правки сценария";
const NO_RIGHTS_SYNC = "Обновить либретто из версии можно только с правом правки сценария";
const CHANGED =
  "Сценарий проекта уже изменился (вторая вкладка или повторное нажатие). Обновите страницу и сделайте предпросмотр заново.";

type ReadFile =
  | { error: string }
  | { file: File; hash: string; typing: BlockTypingResult };

/** Файл из формы: размер, содержимое docx, типы блоков. Одинаково для предпросмотра и записи. */
async function readScriptFile(formData: FormData): Promise<ReadFile> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Выберите файл сценария .docx" };
  }
  // Только .docx: по имени здесь, по содержимому — при разборе.
  if (!file.name.toLowerCase().endsWith(".docx")) {
    return { error: "Нужен файл Word .docx. Другие форматы не поддерживаются." };
  }
  // Браузер присылает облегчённый docx (без картинок) — лимит на него.
  if (file.size > SCRIPT_IMPORT_MAX_BYTES) {
    return {
      error: `Текст сценария в файле — ${formatMegabytes(file.size)}, а можно не больше ${formatMegabytes(SCRIPT_IMPORT_MAX_BYTES)}. Разделите сценарий на части.`,
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let typing: BlockTypingResult;
  try {
    typing = classifyParagraphs(readDocxParagraphs(buffer));
  } catch (error) {
    if (isDocxReadError(error)) return { error: DOCX_ERRORS[error.code] };
    return { error: "Не удалось прочитать файл .docx. Пересохраните его в Word и загрузите снова." };
  }
  if (!typing.blocks.some((b) => b.type === "SLUGLINE")) {
    return {
      error:
        "В файле не найдено ни одной шапки сцены. Ожидается строка вида «1. ИНТ. КВАРТИРА — ДЕНЬ» или стиль Word «Заголовок сцены» / SCENE HEADING.",
    };
  }
  return { file, hash: createHash("sha256").update(buffer).digest("hex"), typing };
}

/**
 * Предпросмотр импорта. Ничего не пишет в базу: разбирает файл, читает словарь, имена
 * и сцены проекта, отдаёт браузеру блоки с типами. Только с правом правки сценария.
 */
export async function previewScriptImportAction(
  projectId: string,
  _prev: ScriptPreviewState,
  formData: FormData,
): Promise<ScriptPreviewState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: NO_RIGHTS };

  const read = await readScriptFile(formData);
  if ("error" in read) return { error: read.error };

  const context = await loadImportContext(projectId);
  return {
    data: {
      fileName: read.file.name,
      fileSize: read.file.size,
      fileHash: read.hash,
      typing: read.typing,
      ...context,
    },
  };
}

const answersSchema = z.record(z.string().max(500), z.string().max(500));
const titleField = z.string().max(500).optional();
const titleEditsSchema = z.object({
  title: titleField,
  subtitle: titleField,
  author: titleField,
  version: titleField,
  date: titleField,
  city: titleField,
});

function parseJson<T>(schema: z.ZodType<T>, value: FormDataEntryValue | null): T | null {
  if (typeof value !== "string") return null;
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

/**
 * «Импортировать». От браузера — только файл, ответы по кодам вопросов, правки титульной,
 * хэш файла и id версии с предпросмотра. Сервер разбирает файл заново и применяет ответы
 * той же нормализацией; неизвестные коды ответов не используются.
 */
export async function importScriptAction(
  projectId: string,
  _prev: ScriptImportState,
  formData: FormData,
): Promise<ScriptImportState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: NO_RIGHTS };

  const read = await readScriptFile(formData);
  if ("error" in read) return { error: read.error };
  if (read.hash !== formData.get("fileHash")) {
    return { error: "Файл отличается от того, что был в предпросмотре. Сделайте предпросмотр заново." };
  }
  const answers = parseJson(answersSchema, formData.get("answers"));
  const titleEdits = parseJson(titleEditsSchema, formData.get("titleEdits"));
  if (!answers || !titleEdits || Object.keys(answers).length > 10_000) {
    return { error: "Некорректные данные импорта" };
  }
  const expected = formData.get("currentVersionId");
  const expectedVersionId = typeof expected === "string" && expected ? expected : null;

  const context = await loadImportContext(projectId);
  if (context.currentVersionId !== expectedVersionId) return { error: CHANGED };

  const result = normalizeScript(read.typing, answers, {
    dictionary: context.dictionary,
    existing: context.existing,
    timing: context.timing,
  });
  const blocking = blockingQuestions(result);
  if (blocking > 0) {
    return {
      error: `Без ответа обязательных вопросов: ${blocking}. Если вы на всё ответили — данные проекта изменились, сделайте предпросмотр заново.`,
    };
  }
  const plan = planImport(result, answers, context.existing, context.timing, titleEdits);

  const fileName = read.file.name;
  const fileSize = read.file.size;
  let written: ScriptWriteResult;
  try {
    written = await auditMutation(
      ctx,
      writeScript,
      {
        projectId,
        userId: ctx.user.id!,
        target: {
          kind: "new",
          expectedVersionId,
          title: fileName.replace(/\.docx$/i, ""),
          sourceType: "IMPORTED_DOCX",
        },
        plan,
      } satisfies ScriptWriteInput,
      {
        projectId,
        entityType: AuditEntityType.scriptVersion,
        action: "CREATE",
        entityId: (_input, r) => r.versionId,
        // Без текста сценария и титульной (там бывают почты и телефоны).
        summary: (_input, r) =>
          `Импорт сценария: ${fileName}, версия ${r.versionNumber}; сцен создано ${r.scenesCreated}, привязано ${r.scenesMatched}`,
        changes: (_input, r) => ({
          file: { name: fileName, size: fileSize },
          ...writeChanges(result, r),
        }),
      },
    );
  } catch (error) {
    if (isScriptVersionConflictError(error)) return { error: CHANGED };
    throw error;
  }

  revalidateScript(projectId);
  return {
    success: `Импортирована версия ${written.versionNumber}: сцен новых ${written.scenesCreated}, привязано ${written.scenesMatched}`,
    versionId: written.versionId,
  };
}

/** Счётчики импорта и синхронизации для журнала — без текста сценария и титульной. */
function writeChanges(result: NormalizedScript, r: ScriptWriteResult) {
  return {
    versionNumber: r.versionNumber,
    scenes: {
      created: r.scenesCreated,
      matched: r.scenesMatched,
      cut: r.scenesCut,
      restored: r.scenesRestored,
    },
    characters: {
      created: r.charactersCreated,
      linked: result.characters.filter((c) => c.existingId).length,
    },
    locations: {
      created: r.locationsCreated,
      linked: result.locations.filter((l) => l.existing).length,
    },
    linksRemoved: r.linksRemoved,
    // Хронометраж совпавших сцен: заполнен пустой / пересчитан по ответу.
    timing: {
      filled: result.timingUpdates.filter((u) => u.mode === "fill").length,
      recalculated: result.timingUpdates.filter((u) => u.mode === "set").length,
    },
    dictionaryRules: r.rules,
  };
}

function revalidateScript(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/screenplay`);
  revalidatePath(`/ru/projects/${projectId}/libretto`);
  revalidatePath(`/ru/projects/${projectId}/script`);
  revalidatePath(`/ru/projects/${projectId}/schedule`);
  revalidatePath(`/ru/projects/${projectId}`);
}

const VERSION_CHANGED =
  "Версия сценария изменилась с момента предпросмотра (правка, вторая вкладка или повторное нажатие). Обновите страницу.";

/**
 * «Обновить либретто» из версии сценария — та же нормализация и та же запись, что у импорта.
 * От браузера — только ответы и хэш блоков версии с предпросмотра. Текст версии не меняется,
 * у её блоков обновляется сцена; версия становится текущей. Только с правом правки сценария.
 */
export async function syncScriptAction(
  projectId: string,
  versionId: string,
  _prev: ScriptImportState,
  formData: FormData,
): Promise<ScriptImportState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: NO_RIGHTS_SYNC };

  const source = await loadVersionSource(projectId, versionId);
  if (!source) return { error: "Версия не найдена" };
  if (source.hash !== formData.get("fileHash")) return { error: VERSION_CHANGED };
  const expected = formData.get("currentVersionId");
  const expectedVersionId = typeof expected === "string" && expected ? expected : null;
  const answers = parseJson(answersSchema, formData.get("answers"));
  if (!answers || Object.keys(answers).length > 10_000) {
    return { error: "Некорректные данные синхронизации" };
  }

  const typing = typingFromVersionBlocks(source.blocks);
  if (!typing.blocks.some((b) => b.type === "SLUGLINE")) {
    return { error: "В версии нет шапок сцен — нечего переносить в либретто." };
  }
  const context = await loadImportContext(projectId, { referenceVersionId: versionId });
  // Как у импорта: текущая версия проекта сменилась (импорт в другой вкладке) — отказ,
  // иначе эта версия молча стала бы текущей.
  if (context.currentVersionId !== expectedVersionId) return { error: CHANGED };
  const result = normalizeScript(typing, answers, {
    dictionary: context.dictionary,
    existing: context.existing,
    sync: true,
    timing: context.timing,
  });
  const blocking = blockingQuestions(result);
  if (blocking > 0) {
    return {
      error: `Без ответа обязательных вопросов: ${blocking}. Если вы на всё ответили — данные проекта изменились, обновите страницу.`,
    };
  }
  const plan = planImport(result, answers, context.existing, context.timing);

  // Сцена каждого блока версии: свой блок нормализации или предыдущий (выброшенные «(ДАЛЬШЕ)»).
  const sceneOfBlock = new Map(result.blocks.map((b) => [b.paragraphIndex, b.sceneIndex]));
  let last: number | null = null;
  const blocks = source.blocks.map((block, index) => {
    if (sceneOfBlock.has(index)) last = sceneOfBlock.get(index) ?? null;
    return { id: block.id, scene: last };
  });

  let written: ScriptWriteResult;
  try {
    written = await auditMutation(
      ctx,
      writeScript,
      {
        projectId,
        userId: ctx.user.id!,
        target: {
          kind: "existing",
          versionId,
          expectedVersionId,
          blocksHash: source.hash,
          blocks,
        },
        plan,
      } satisfies ScriptWriteInput,
      {
        projectId,
        entityType: AuditEntityType.scriptVersion,
        action: "UPDATE",
        entityId: versionId,
        summary: (_input, r) =>
          `Либретто обновлено из версии ${r.versionNumber}: сцен создано ${r.scenesCreated}, привязано ${r.scenesMatched}`,
        changes: (_input, r) => writeChanges(result, r),
      },
    );
  } catch (error) {
    if (error instanceof VersionBlocksChangedError) return { error: VERSION_CHANGED };
    if (isScriptVersionConflictError(error)) return { error: CHANGED };
    throw error;
  }

  revalidateScript(projectId);
  return {
    success: `Либретто обновлено: сцен новых ${written.scenesCreated}, привязано ${written.scenesMatched}`,
    versionId,
  };
}
