import { NextResponse } from "next/server";
import type { ProjectFileKind } from "@prisma/client";
import {
  buildStorageKey,
  mediaApiUrl,
  putProjectObject,
} from "@/features/files/lib/storage";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

const MAX_BYTES = 512 * 1024 * 1024; // 512 MB

const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "avi", "mkv"]);
const IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "bmp",
  "heic",
]);

function detectKind(file: File): ProjectFileKind {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (file.type.startsWith("image/") || IMAGE_EXT.has(ext)) return "IMAGE";
  if (file.type.startsWith("video/") || VIDEO_EXT.has(ext)) return "VIDEO";
  return "OTHER";
}

function safeExt(file: File, kind: ProjectFileKind): string {
  const raw = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (raw && raw.length <= 8) return raw;
  if (kind === "IMAGE") return "jpg";
  if (kind === "VIDEO") return "mp4";
  return "bin";
}

/** General project file upload (device → ProjectFile + storage). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  try {
    const ctx = await requireProjectContext(projectId);
    if (!ctx.can("script:write") && !ctx.can("project:write") && !ctx.can("finance:write")) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Пустой файл" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Максимум 512 МБ на файл" },
        { status: 400 },
      );
    }

    const kind = detectKind(file);
    const ext = safeExt(file, kind);
    const mimeType =
      file.type ||
      (kind === "IMAGE"
        ? `image/${ext}`
        : kind === "VIDEO"
          ? `video/${ext}`
          : "application/octet-stream");

    const row = await prisma.projectFile.create({
      data: {
        projectId,
        kind,
        status: "UPLOADING",
        storageKey: "pending",
        originalName: file.name.slice(0, 255),
        mimeType,
        sizeBytes: file.size,
        createdById: ctx.user.id,
      },
    });

    try {
      const storageKey = buildStorageKey(projectId, row.id, ext);
      const buffer = Buffer.from(await file.arrayBuffer());
      await putProjectObject(storageKey, buffer, mimeType);

      const url = mediaApiUrl(projectId, row.id);
      const updated = await prisma.projectFile.update({
        where: { id: row.id },
        data: {
          storageKey,
          url,
          status: "READY",
        },
      });

      return NextResponse.json({
        id: updated.id,
        url: updated.url,
        status: updated.status,
        kind: updated.kind,
        originalName: updated.originalName,
        sizeBytes: updated.sizeBytes,
        mimeType: updated.mimeType,
      });
    } catch (err) {
      await prisma.projectFile.update({
        where: { id: row.id },
        data: { status: "FAILED" },
      });
      throw err;
    }
  } catch (err) {
    console.error("[file-upload]", err);
    return NextResponse.json({ error: "Ошибка загрузки" }, { status: 500 });
  }
}
