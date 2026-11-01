"use server";

import { loadCallSheetPrintModel } from "@/features/call-sheets/print/load-print-model";
import { buildCallSheetHtml } from "@/features/call-sheets/print/print-html";

/**
 * «Печать / PDF»: HTML листа для окна печати (`window.open` → `document.write`).
 * Право — «КПП и вызывные: просмотр», день — этого проекта; ничего не пишет.
 * Утверждённый — из снимка; `version` — снимок утверждённой версии N (список версий).
 */
export async function getCallSheetPrintHtmlAction(
  projectId: string,
  dayId: string,
  version?: number,
): Promise<{ html: string; fileName: string } | { error: string }> {
  const loaded = await loadCallSheetPrintModel(projectId, dayId, version);
  if ("error" in loaded) return { error: loaded.error };
  return {
    html: buildCallSheetHtml(loaded.model, { font: "embed", stamp: loaded.stamp }),
    fileName: `${loaded.fileBaseName}.html`,
  };
}
