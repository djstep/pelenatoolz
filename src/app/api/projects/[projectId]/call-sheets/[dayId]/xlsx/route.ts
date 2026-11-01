import { PassThrough, Readable } from "node:stream";
import { loadCallSheetPrintModel } from "@/features/call-sheets/print/load-print-model";
import { attachmentDisposition } from "@/features/call-sheets/print/print-source";
import { writeCallSheetXlsx } from "@/features/call-sheets/print/print-xlsx";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Вызывной лист дня в Excel. Вход, проект и право «вызывные/КПП: просмотр» проверяет
 * `loadCallSheetPrintModel` (нет входа — редирект, чужой проект — 404); его исключения
 * не перехватываются. Ничего не пишет в базу.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; dayId: string }> },
) {
  const { projectId, dayId } = await params;
  const result = await loadCallSheetPrintModel(projectId, dayId);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  const output = new PassThrough();
  writeCallSheetXlsx(result.model, output).catch((err: unknown) => {
    output.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return new Response(Readable.toWeb(output) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": attachmentDisposition(`${result.fileBaseName}.xlsx`),
      "Cache-Control": "private, no-store",
    },
  });
}
