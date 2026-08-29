"use server";

import { PostStage, PostTaskStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { writeAuditLog } from "@/shared/audit/log";

export type PostActionState = { error?: string; success?: string };

function revalidatePost(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/post`);
  revalidatePath(`/ru/projects/${projectId}`);
}

const taskSchema = z.object({
  stage: z.enum(PostStage),
  status: z.enum(PostTaskStatus),
  title: z.string().trim().min(1).max(200),
  episodeNumber: z.coerce.number().int().min(0).max(9999).optional(),
  assignee: z.string().trim().max(120).optional(),
  dueDate: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createPostTaskAction(
  projectId: string,
  _prev: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("post:write")) {
    return { error: "Недостаточно прав" };
  }

  const episodeRaw = formData.get("episodeNumber");
  const parsed = taskSchema.safeParse({
    stage: formData.get("stage") || "EDIT",
    status: formData.get("status") || "TODO",
    title: formData.get("title"),
    episodeNumber:
      episodeRaw !== null && String(episodeRaw).trim() !== ""
        ? episodeRaw
        : undefined,
    assignee: formData.get("assignee") || undefined,
    dueDate: formData.get("dueDate") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { error: "Проверьте данные задачи" };
  }

  const maxOrder = await prisma.postTask.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  const task = await prisma.postTask.create({
    data: {
      projectId,
      stage: parsed.data.stage,
      status: parsed.data.status,
      title: parsed.data.title,
      episodeNumber: parsed.data.episodeNumber,
      assignee: parsed.data.assignee,
      dueDate: parsed.data.dueDate
        ? new Date(parsed.data.dueDate)
        : null,
      notes: parsed.data.notes,
      sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
    },
  });

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "post_task",
    entityId: task.id,
    action: "CREATE",
    summary: `Пост: ${task.title}`,
  });

  revalidatePost(projectId);
  return { success: "Задача добавлена" };
}

export async function updatePostTaskAction(
  projectId: string,
  taskId: string,
  _prev: PostActionState,
  formData: FormData,
): Promise<PostActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("post:write")) {
    return { error: "Недостаточно прав" };
  }

  const episodeRaw = formData.get("episodeNumber");
  const parsed = taskSchema.safeParse({
    stage: formData.get("stage") || "EDIT",
    status: formData.get("status") || "TODO",
    title: formData.get("title"),
    episodeNumber:
      episodeRaw !== null && String(episodeRaw).trim() !== ""
        ? episodeRaw
        : undefined,
    assignee: formData.get("assignee") || undefined,
    dueDate: formData.get("dueDate") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { error: "Проверьте данные задачи" };
  }

  await prisma.postTask.updateMany({
    where: { id: taskId, projectId },
    data: {
      stage: parsed.data.stage,
      status: parsed.data.status,
      title: parsed.data.title,
      episodeNumber: parsed.data.episodeNumber ?? null,
      assignee: parsed.data.assignee,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      notes: parsed.data.notes,
    },
  });

  revalidatePost(projectId);
  return { success: "Сохранено" };
}

export async function setPostTaskStatusAction(
  projectId: string,
  taskId: string,
  status: PostTaskStatus,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("post:write")) {
    throw new Error("FORBIDDEN");
  }
  await prisma.postTask.updateMany({
    where: { id: taskId, projectId },
    data: { status },
  });
  revalidatePost(projectId);
}

export async function deletePostTaskAction(projectId: string, taskId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("post:write")) {
    throw new Error("FORBIDDEN");
  }
  await prisma.postTask.deleteMany({ where: { id: taskId, projectId } });
  revalidatePost(projectId);
}
