import { MEDEO_FONT_FILE_NAME, readMedeoFontFile } from "@/features/call-sheets/print/medeo-font";

/**
 * Шрифт листа вызывного для просмотра на странице. Лицензия OFL — отдаётся без входа.
 * Только один файл с версией пакета в имени, поэтому кэш — навсегда.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (file !== MEDEO_FONT_FILE_NAME) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(readMedeoFontFile()), {
    headers: {
      "Content-Type": "font/woff2",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
