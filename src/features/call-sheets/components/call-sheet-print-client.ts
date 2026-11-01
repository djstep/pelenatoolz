"use client";

import { getCallSheetPrintHtmlAction } from "@/features/call-sheets/print-actions";
import { printWhenImagesSettled } from "@/shared/lib/print-window";

/**
 * Печать и Excel вызывного из браузера: меню «Экспорт» и список утверждённых версий.
 * `version` — снимок утверждённой версии N; без него — как сейчас (утверждённый — снимок,
 * черновик — живые данные). Вход, право и день проверяет сервер.
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Имя файла из `Content-Disposition`: сначала `filename*=UTF-8''…`, потом `filename="…"`. */
function fileNameFromDisposition(header: string | null, fallback: string) {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // битое имя — ниже запасное
    }
  }
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

/** Excel вызывного — файлом из маршрута. */
export async function fetchCallSheetXlsx(
  projectId: string,
  dayId: string,
  version?: number,
): Promise<{ blob: Blob; fileName: string } | { error: string }> {
  const query = version ? `?version=${version}` : "";
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/call-sheets/${encodeURIComponent(dayId)}/xlsx${query}`,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { error: body?.error ?? "Не удалось выгрузить Excel" };
  }
  // Вход истёк — вместо файла пришла страница входа.
  if (!res.headers.get("Content-Type")?.startsWith(XLSX_MIME)) {
    return { error: "Не удалось выгрузить Excel — обновите страницу и войдите снова" };
  }
  return {
    blob: await res.blob(),
    fileName: fileNameFromDisposition(res.headers.get("Content-Disposition"), "Вызывной.xlsx"),
  };
}

/** Окно печати — как в кастинге: HTML с сервера → `document.write` → печать после фото и шрифтов. */
export async function printCallSheet(
  projectId: string,
  dayId: string,
  version?: number,
): Promise<{ error?: string }> {
  const result = await getCallSheetPrintHtmlAction(projectId, dayId, version);
  if ("error" in result) return { error: result.error };
  const win = window.open("", "_blank");
  if (!win) return { error: "Браузер не открыл окно печати — разрешите всплывающие окна" };
  win.document.write(result.html);
  win.document.close();
  // Скрипты в странице печати запрещены (CSP) — печать вызывается отсюда.
  printWhenImagesSettled(win);
  return {};
}
