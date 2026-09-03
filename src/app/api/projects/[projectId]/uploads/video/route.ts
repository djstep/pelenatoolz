import { NextResponse } from "next/server";
import { scheduleVideoProcessing } from "@/features/files/lib/process-video";
import {
  buildStorageKey,
  mediaApiUrl,
  putProjectObject,
} from "@/features/files/lib/storage";
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
const MAX_BYTES = 512 * 1024 * 1024; // 512 MB

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

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
    }

    const isVideo =
      file.type.startsWith("video/") ||
      VIDEO_EXT.has(
        (file.name.split(".").pop() ?? "").toLowerCase(),
      );
    if (!isVideo) {
      return NextResponse.json(
        { error: "Допустимы только видеофайлы" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Максимум 512 МБ на файл" },
        { status: 400 },
      );
    }

    const rawExt = (file.name.split(".").pop() ?? "mp4").toLowerCase();
    const ext = VIDEO_EXT.has(rawExt) ? rawExt : "mp4";
    const row = await prisma.projectFile.create({
      data: {
        projectId,
        kind: "VIDEO",
        status: "UPLOADING",
        storageKey: "pending",
        originalName: file.name.slice(0, 255),
        mimeType: file.type || `video/${ext}`,
        sizeBytes: file.size,
        createdById: ctx.user.id,
      },
    });

    const storageKey = buildStorageKey(projectId, row.id, ext);
    const buffer = Buffer.from(await file.arrayBuffer());
    await putProjectObject(storageKey, buffer, file.type || `video/${ext}`);

    const url = mediaApiUrl(projectId, row.id);
    const updated = await prisma.projectFile.update({
      where: { id: row.id },
      data: {
        storageKey,
        url,
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
