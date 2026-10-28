"use server";

import { CloudProvider } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { getCloudConnection } from "@/features/cloud/lib/cloud-service";
import { prisma } from "@/shared/db/prisma";

export type CloudActionState = { error?: string; success?: string };

export async function disconnectCloudAction(
  connectionId: string,
): Promise<CloudActionState> {
  const user = await requireUser();
  const conn = await prisma.cloudConnection.findFirst({
    where: { id: connectionId, userId: user.id! },
  });
  if (!conn) {
    return { error: "Подключение не найдено" };
  }
  await prisma.cloudConnection.delete({ where: { id: connectionId } });
  revalidatePath("/ru/projects", "layout");
  return { success: "Облако отключено" };
}

export async function attachCloudFileAction(
  projectId: string,
  input: {
    provider: CloudProvider;
    externalId: string;
    path?: string | null;
    name: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    webUrl?: string | null;
    notes?: string | null;
  },
): Promise<CloudActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("project:write") && !ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const conn = await getCloudConnection(ctx.user.id!, input.provider);

  await prisma.cloudFileLink.create({
    data: {
      projectId,
      connectionId: conn?.id,
      provider: input.provider,
      externalId: input.externalId,
      path: input.path,
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes != null ? BigInt(input.sizeBytes) : null,
      webUrl: input.webUrl,
      notes: input.notes,
    },
  });

  revalidatePath(`/ru/projects/${projectId}/files`);
  return { success: "Файл прикреплён" };
}

export async function deleteCloudFileLinkAction(
  projectId: string,
  linkId: string,
): Promise<CloudActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("project:write") && !ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const link = await prisma.cloudFileLink.findFirst({
    where: { id: linkId, projectId },
    select: { name: true },
  });
  if (!link) return { error: "Ссылка не найдена" };
  await prisma.cloudFileLink.deleteMany({
    where: { id: linkId, projectId },
  });
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.cloudFileLink,
    entityId: linkId,
    action: "DELETE",
    summary: `Удалена ссылка на облачный файл «${link.name}»`,
  });

  revalidatePath(`/ru/projects/${projectId}/files`);
  return { success: "Ссылка удалена" };
}
