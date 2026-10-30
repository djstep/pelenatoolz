"use server";

import { createHash } from "crypto";
import { classifyParagraphs } from "@/features/import/normalize/block-types";
import { readDocxParagraphs } from "@/features/import/normalize/docx-paragraphs";
import { isDocxReadError, type DocxReadErrorCode } from "@/features/import/normalize/docx-zip";
import { loadImportContext } from "@/features/import/review/load-context";
import {
  formatMegabytes,
  SCRIPT_IMPORT_MAX_BYTES,
  type ScriptPreviewState,
} from "@/features/import/review/types";
import { requireProjectContext } from "@/features/projects/lib/project-context";

const DOCX_ERRORS: Record<DocxReadErrorCode, string> = {
  not_zip: "Это не файл Word (.docx). Сохраните сценарий в Word как .docx и загрузите снова.",
  not_docx: "Это не документ Word (.docx). Сохраните сценарий в Word как .docx и загрузите снова.",
  too_many_files: "Файл .docx устроен необычно: слишком много частей внутри. Пересохраните его в Word.",
  too_large: "Файл .docx после распаковки слишком большой. Уберите из него картинки или разделите сценарий.",
  unsupported: "Файл .docx сжат неподдерживаемым способом. Пересохраните его в Word.",
};

/**
 * Предпросмотр импорта. Ничего не пишет в базу: разбирает файл, читает словарь и имена проекта,
 * отдаёт браузеру блоки с типами. Только с правом правки сценария.
 */
export async function previewScriptImportAction(
  projectId: string,
  _prev: ScriptPreviewState,
  formData: FormData,
): Promise<ScriptPreviewState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Импорт сценария доступен только с правом правки сценария" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Выберите файл сценария .docx" };
  }
  if (file.size > SCRIPT_IMPORT_MAX_BYTES) {
    return {
      error: `Файл ${formatMegabytes(file.size)}, а можно не больше ${formatMegabytes(SCRIPT_IMPORT_MAX_BYTES)}. Уберите из него картинки или разделите сценарий.`,
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let typing;
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

  const context = await loadImportContext(projectId);
  return {
    data: {
      fileName: file.name,
      fileSize: file.size,
      fileHash: createHash("sha256").update(buffer).digest("hex"),
      typing,
      ...context,
    },
  };
}
