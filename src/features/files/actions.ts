"use server";

import { revalidatePath } from "next/cache";
import {
  deleteProjectObject,
} from "@/features/files/lib/storage";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

export async function deleteProjectUploadedFileAction(
  projectId: string,
  fileId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write") && !ctx.can("project:write")) {
    return { error: "Недостаточно прав" };
  }

  const file = await prisma.projectFile.findFirst({
    where: { id: fileId, projectId },
  });
  if (!file) return { error: "Файл не найден" };

  // Don't delete if still linked to auditions — clear link first or block
  const linked = await prisma.audition.count({
    where: { videoFileId: fileId },
  });
  if (linked > 0) {
    return {
      error:
        "Файл используется в пробах. Сначала отвяжите видео от проб или удалите пробы.",
    };
  }

  await prisma.projectFile.delete({ where: { id: fileId } });
  if (file.storageKey && file.storageKey !== "pending") {
    await deleteProjectObject(file.storageKey);
  }

  revalidatePath(`/ru/projects/${projectId}/files`);
  return { success: "Файл удалён" };
}
