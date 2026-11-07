import { NextResponse } from "next/server";
import { parseByteRange } from "@/features/files/lib/byte-range";
import { canReadProjectFile, projectFileHeaders } from "@/features/files/lib/file-access";
import { projectObjectSize, projectObjectStream } from "@/features/files/lib/storage";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

export async function GET(
  request: Request,
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

    const size = await projectObjectSize(file.storageKey);
    if (size == null) {
      return NextResponse.json({ error: "Файл отсутствует" }, { status: 404 });
    }

    const range = parseByteRange(request.headers.get("range"), size);
    if (range === "unsatisfiable") {
      return new NextResponse(null, {
        status: 416,
        headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` },
      });
    }

    const headers = {
      ...projectFileHeaders(file.mimeType, file.originalName),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    };
    if (range) {
      return new NextResponse(projectObjectStream(file.storageKey, range), {
        status: 206,
        headers: {
          ...headers,
          "Content-Length": String(range.end - range.start + 1),
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        },
      });
    }
    return new NextResponse(projectObjectStream(file.storageKey), {
      headers: { ...headers, "Content-Length": String(size) },
    });
  } catch {
    return NextResponse.json({ error: "Ошибка чтения" }, { status: 500 });
  }
}
