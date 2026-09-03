import { after } from "next/server";
import { prisma } from "@/shared/db/prisma";

/**
 * Background video processing stub.
 * Real encoding (ffmpeg / Cloudflare Stream) plugs in here later.
 * Saving the audition form must not wait for this.
 */
export function scheduleVideoProcessing(fileId: string) {
  after(async () => {
    try {
      await prisma.projectFile.update({
        where: { id: fileId },
        data: { status: "PROCESSING" },
      });
      // Placeholder: mark ready once "processing" finishes.
      await prisma.projectFile.update({
        where: { id: fileId },
        data: { status: "READY" },
      });
    } catch (err) {
      console.error("[video-process]", fileId, err);
      await prisma.projectFile
        .update({
          where: { id: fileId },
          data: { status: "FAILED" },
        })
        .catch(() => undefined);
    }
  });
}
