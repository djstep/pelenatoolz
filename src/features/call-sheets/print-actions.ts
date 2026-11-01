"use server";

import { loadCallSheetPrintModel } from "@/features/call-sheets/print/load-print-model";
import { buildCallSheetHtml } from "@/features/call-sheets/print/print-html";

const PRINT_BUILD_FAILED = "Не удалось собрать лист для печати — попробуйте ещё раз";

/**
 * «Печать / PDF»: HTML листа для окна печати (`window.open` → `document.write`).
 * Право — «КПП и вызывные: просмотр», день — этого проекта; ничего не пишет.
 * Утверждённый — из снимка; `version` — снимок утверждённой версии N (список версий).
 * Сбой сборки (например, нет файла шрифта) — ответ с ошибкой, а не исключение: окно печати
 * закрывается и пользователь видит сообщение.
 */
export async function getCallSheetPrintHtmlAction(
  projectId: string,
  dayId: string,
  version?: number,
): Promise<{ html: string; fileName: string } | { error: string }> {
  const loaded = await loadCallSheetPrintModel(projectId, dayId, version);
  if ("error" in loaded) return { error: loaded.error };
  try {
    return {
      html: buildCallSheetHtml(loaded.model, { font: "embed", stamp: loaded.stamp }),
      fileName: `${loaded.fileBaseName}.html`,
    };
  } catch (error) {
    console.error("[call-sheet print] сборка листа", error);
    return { error: PRINT_BUILD_FAILED };
  }
}
