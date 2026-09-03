import { NextResponse } from "next/server";
import { getProjectObject } from "@/features/files/lib/storage";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ projectId: string; fileId: string }> },
) {
  const { projectId, fileId } = await params;

  try {
    const ctx = await requireProjectContext(projectId);
    if (!ctx.can("cast:read") && !ctx.can("project:read")) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const file = await prisma.projectFile.findFirst({
      where: { id: fileId, projectId },
    });
    if (!file) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }

    const data = await getProjectObject(file.storageKey);
    if (!data) {
      return NextResponse.json({ error: "Файл отсутствует" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(data.byteLength),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalName)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Ошибка чтения" }, { status: 500 });
  }
}
