import { loadCallSheetPrintModel } from "@/features/call-sheets/print/load-print-model";
import { buildCallSheetHtml, callSheetCsp } from "@/features/call-sheets/print/print-html";

/**
 * Лист вызывного для просмотра на странице (`<iframe src sandbox>`): тот же HTML, что в печать,
 * но шрифт — файлом с сайта (кэшируется), а не встроен. Вход, проект и право «КПП и вызывные:
 * просмотр» проверяет `loadCallSheetPrintModel`; его исключения не перехватываются.
 * Ничего не пишет. Параметр `v` в адресе нужен только странице — чтобы после правок
 * просмотр перезагрузился.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; dayId: string }> },
) {
  const { projectId, dayId } = await params;
  const result = await loadCallSheetPrintModel(projectId, dayId);
  if ("error" in result) {
    return new Response(result.error, {
      status: result.status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }

  return new Response(buildCallSheetHtml(result.model, { font: "url" }), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Тот же запрет скриптов, что в листе, и вдобавок песочница — даже если адрес открыть
      // отдельной вкладкой; встраивать — только своему сайту.
      "Content-Security-Policy": `${callSheetCsp("url")}; sandbox allow-same-origin; frame-ancestors 'self'`,
    },
  });
}
