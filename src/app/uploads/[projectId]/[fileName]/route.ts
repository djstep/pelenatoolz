import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProjectForUser } from "@/features/projects/queries";
import { uploadContentType, uploadFilePath, uploadsRoot } from "@/shared/lib/upload-storage";

const NOT_FOUND = { error: "Файл не найден" };

/** Картинка проекта: только активному участнику. Чужому ответ тот же, что на несуществующий файл. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; fileName: string }> },
) {
  const { projectId, fileName } = await params;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }

  const filePath = uploadFilePath(uploadsRoot(), projectId, fileName);
  const contentType = uploadContentType(fileName);
  if (!filePath || !contentType) return NextResponse.json(NOT_FOUND, { status: 404 });

  const project = await getProjectForUser(projectId, session.user.id);
  if (!project) return NextResponse.json(NOT_FOUND, { status: 404 });

  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
