"use server";

import { loadCallSheetPrintModel } from "@/features/call-sheets/print/load-print-model";
import { buildCallSheetHtml } from "@/features/call-sheets/print/print-html";

/**
 * «Печать / PDF»: HTML листа для окна печати (`window.open` → `document.write`).
 * Право — «КПП и вызывные: просмотр», день — этого проекта; ничего не пишет.
 */
export async function getCallSheetPrintHtmlAction(
  projectId: string,
  dayId: string,
): Promise<{ html: string; fileName: string } | { error: string }> {
  const loaded = await loadCallSheetPrintModel(projectId, dayId);
  if ("error" in loaded) return { error: loaded.error };
  return {
    html: buildCallSheetHtml(loaded.model, { font: "embed" }),
    fileName: `${loaded.fileBaseName}.html`,
  };
}
