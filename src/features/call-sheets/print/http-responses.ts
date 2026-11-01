import { PassThrough, Readable } from "node:stream";
import type { CallSheetPrintModel } from "@/features/call-sheets/print/print-model";
import { buildCallSheetHtml, callSheetCsp } from "@/features/call-sheets/print/print-html";
import { attachmentDisposition } from "@/features/call-sheets/print/print-source";
import { writeCallSheetXlsx } from "@/features/call-sheets/print/print-xlsx";

/**
 * Ответы маршрутов листа и Excel вызывного. Данные дня — только для того, у кого есть право,
 * поэтому ни ответ, ни ошибка не кэшируются ни браузером, ни общими кэшами.
 */
export const CALL_SHEET_CACHE_CONTROL = "private, no-store";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Loaded =
  | { model: CallSheetPrintModel; fileBaseName: string }
  | { error: string; status: 403 | 404 };

/** Лист для просмотра на странице (`…/sheet`): HTML со шрифтом по адресу. */
export function callSheetSheetResponse(result: Loaded): Response {
  if ("error" in result) {
    return new Response(result.error, {
      status: result.status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": CALL_SHEET_CACHE_CONTROL },
    });
  }
  return new Response(buildCallSheetHtml(result.model, { font: "url" }), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": CALL_SHEET_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
      // Тот же запрет скриптов, что в листе, и вдобавок песочница — даже если адрес открыть
      // отдельной вкладкой; встраивать — только своему сайту.
      "Content-Security-Policy": `${callSheetCsp("url")}; sandbox allow-same-origin; frame-ancestors 'self'`,
    },
  });
}

/** Excel вызывного (`…/xlsx`): книга пишется в поток. */
export function callSheetXlsxResponse(result: Loaded): Response {
  if ("error" in result) {
    return Response.json(
      { error: result.error },
      { status: result.status, headers: { "Cache-Control": CALL_SHEET_CACHE_CONTROL } },
    );
  }

  const output = new PassThrough();
  writeCallSheetXlsx(result.model, output).catch((err: unknown) => {
    output.destroy(err instanceof Error ? err : new Error(String(err)));
  });

  return new Response(Readable.toWeb(output) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": attachmentDisposition(`${result.fileBaseName}.xlsx`),
      "Cache-Control": CALL_SHEET_CACHE_CONTROL,
    },
  });
}
