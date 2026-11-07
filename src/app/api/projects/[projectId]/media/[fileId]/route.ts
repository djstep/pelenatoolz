import { NextResponse } from "next/server";
import { canReadProjectFile, projectFileHeaders } from "@/features/files/lib/file-access";
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
    const file = await prisma.projectFile.findFirst({
      where: { id: fileId, projectId },
    });
    if (!file) {
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    }

    if (!canReadProjectFile(ctx.can, file.contractsOnly)) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const data = await getProjectObject(file.storageKey);
    if (!data) {
      return NextResponse.json({ error: "Файл отсутствует" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(data), {
      headers: {
        ...projectFileHeaders(file.mimeType, file.originalName),
        "Content-Length": String(data.byteLength),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Ошибка чтения" }, { status: 500 });
  }
}
