import { NextResponse } from "next/server";
import type { ProjectFileKind } from "@prisma/client";
import { videoTypeOf } from "@/features/files/lib/file-access";
import { receiveUpload } from "@/features/files/lib/receive-upload";
import { buildStorageKey, mediaApiUrl } from "@/features/files/lib/storage";
import { readUploadHead } from "@/features/files/lib/upload-request";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

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

function detectKind(name: string, type: string): ProjectFileKind {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (type.startsWith("image/") || IMAGE_EXT.has(ext)) return "IMAGE";
  if (type.startsWith("video/") || VIDEO_EXT.has(ext)) return "VIDEO";
  return "OTHER";
}

function safeExt(name: string, kind: ProjectFileKind): string {
  const raw = (name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
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
    if (
      !ctx.can("script:write") &&
      !ctx.can("project:write") &&
      !ctx.can("finance:write") &&
      !ctx.can("contracts:write")
    ) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const head = readUploadHead(request.headers);
    if ("error" in head) {
      return NextResponse.json({ error: head.error }, { status: head.status });
    }
    if (head.contractsOnly && !ctx.can("contracts:write")) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const kind = detectKind(head.name, head.type);
    const ext = safeExt(head.name, kind);
    const mimeType =
      head.type ||
      (kind === "IMAGE"
        ? `image/${ext}`
        : kind === "VIDEO"
          ? videoTypeOf(ext)
          : "application/octet-stream");

    const row = await prisma.projectFile.create({
      data: {
        projectId,
        kind,
        status: "UPLOADING",
        storageKey: "pending",
        originalName: head.name,
        mimeType,
        sizeBytes: head.declaredBytes ?? 0,
        contractsOnly: head.contractsOnly,
        createdById: ctx.user.id,
      },
    });

    const storageKey = buildStorageKey(projectId, row.id, ext);
    const received = await receiveUpload(row.id, storageKey, request.body);
    if ("error" in received) {
      return NextResponse.json({ error: received.error }, { status: received.status });
    }

    const updated = await prisma.projectFile.update({
      where: { id: row.id },
      data: {
        storageKey,
        url: mediaApiUrl(projectId, row.id),
        sizeBytes: received.sizeBytes,
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
    console.error("[file-upload]", err);
    return NextResponse.json({ error: "Ошибка загрузки" }, { status: 500 });
  }
}
