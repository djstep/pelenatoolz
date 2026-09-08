import { prisma } from "@/shared/db/prisma";

export async function listProjectUploadedFiles(projectId: string) {
  return prisma.projectFile.findMany({
    where: {
      projectId,
      status: { in: ["READY", "UPLOADING", "PROCESSING", "FAILED"] },
      // Skip orphaned pending rows with no storage yet if any linger
      NOT: { storageKey: "pending", status: "UPLOADING" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      kind: true,
      status: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      url: true,
      createdAt: true,
    },
  });
}
