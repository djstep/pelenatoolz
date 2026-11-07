import { NextResponse } from "next/server";
import { videoTypeOf } from "@/features/files/lib/file-access";
import { scheduleVideoProcessing } from "@/features/files/lib/process-video";
import { receiveUpload } from "@/features/files/lib/receive-upload";
import { buildStorageKey, mediaApiUrl } from "@/features/files/lib/storage";
import { readUploadHead } from "@/features/files/lib/upload-request";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

const VIDEO_EXT = new Set([
  "mp4",
  "webm",
  "mov",
  "m4v",
  "avi",
  "mkv",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  try {
    const ctx = await requireProjectContext(projectId);
    if (!ctx.can("cast:write") && !ctx.can("project:write")) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const head = readUploadHead(request.headers);
    if ("error" in head) {
      return NextResponse.json({ error: head.error }, { status: head.status });
    }

    const rawExt = (head.name.split(".").pop() ?? "mp4").toLowerCase();
    if (!head.type.startsWith("video/") && !VIDEO_EXT.has(rawExt)) {
      return NextResponse.json(
        { error: "Допустимы только видеофайлы" },
        { status: 400 },
      );
    }

    const ext = VIDEO_EXT.has(rawExt) ? rawExt : "mp4";
    const row = await prisma.projectFile.create({
      data: {
        projectId,
        kind: "VIDEO",
        status: "UPLOADING",
        storageKey: "pending",
        originalName: head.name,
        mimeType: head.type || videoTypeOf(ext),
        sizeBytes: head.declaredBytes ?? 0,
        createdById: ctx.user.id,
      },
    });

    const storageKey = buildStorageKey(projectId, row.id, ext);
    const received = await receiveUpload(row.id, storageKey, request.body);
    if ("error" in received) {
      return NextResponse.json({ error: received.error }, { status: received.status });
    }

    const url = mediaApiUrl(projectId, row.id);
    const updated = await prisma.projectFile.update({
      where: { id: row.id },
      data: {
        storageKey,
        url,
        sizeBytes: received.sizeBytes,
        status: "PROCESSING",
      },
    });

    scheduleVideoProcessing(updated.id);

    return NextResponse.json({
      id: updated.id,
      url: updated.url,
      status: updated.status,
      originalName: updated.originalName,
    });
  } catch (err) {
    console.error("[video-upload]", err);
    return NextResponse.json({ error: "Ошибка загрузки" }, { status: 500 });
  }
}
