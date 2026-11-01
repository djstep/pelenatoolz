import { callSheetXlsxResponse } from "@/features/call-sheets/print/http-responses";
import { loadCallSheetPrintModel } from "@/features/call-sheets/print/load-print-model";

/**
 * Вызывной лист дня в Excel. Вход, проект и право «вызывные/КПП: просмотр» проверяет
 * `loadCallSheetPrintModel` (нет входа — редирект, чужой проект — 404); его исключения
 * не перехватываются. Ничего не пишет в базу. Ответ не кэшируется (`private, no-store`).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; dayId: string }> },
) {
  const { projectId, dayId } = await params;
  return callSheetXlsxResponse(await loadCallSheetPrintModel(projectId, dayId));
}
