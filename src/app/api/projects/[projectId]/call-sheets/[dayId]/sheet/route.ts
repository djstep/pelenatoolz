import { callSheetSheetResponse } from "@/features/call-sheets/print/http-responses";
import { loadCallSheetPrintModel } from "@/features/call-sheets/print/load-print-model";

/**
 * Лист вызывного для просмотра на странице (`<iframe src sandbox>`): тот же HTML, что в печать,
 * но шрифт — файлом с сайта (кэшируется), а не встроен. Вход, проект и право «КПП и вызывные:
 * просмотр» проверяет `loadCallSheetPrintModel`; его исключения не перехватываются.
 * Ничего не пишет. Ответ не кэшируется (`private, no-store`). Параметр `v` в адресе нужен
 * только странице — чтобы после правок просмотр перезагрузился.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; dayId: string }> },
) {
  const { projectId, dayId } = await params;
  return callSheetSheetResponse(await loadCallSheetPrintModel(projectId, dayId));
}
