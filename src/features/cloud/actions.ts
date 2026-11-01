"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { revokeCloudConnectionTokens } from "@/features/cloud/lib/cloud-service";
import {
  linkSiteLabel,
  MAX_LINK_NAME_LENGTH,
  parseCloudLink,
} from "@/features/cloud/lib/cloud-link";
import { cloudProviderLabels } from "@/features/cloud/lib/types";
import { prisma } from "@/shared/db/prisma";

export type CloudActionState = { error?: string; success?: string };

/** Отключить свой диск: запись удаляется, токен отзывается у Google / Яндекса, запись в журнал. */
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
  await prisma.cloudConnection.delete({ where: { id: conn.id } });
  // После удаления: даже если отзыв не удался, система токеном больше не пользуется.
  const revoked = await revokeCloudConnectionTokens(conn);
  await recordAudit(
    { user: { id: user.id! } },
    {
      projectId: null,
      entityType: AuditEntityType.cloudConnection,
      entityId: conn.id,
      action: "DELETE",
      summary: `Отключён личный ${cloudProviderLabels[conn.provider]}`,
      changes: { provider: conn.provider, tokenRevoked: revoked },
    },
  );
  revalidatePath("/ru/profile");
  revalidatePath("/ru/projects", "layout");
  return {
    success: revoked
      ? "Диск отключён"
      : "Диск отключён. Отозвать доступ у провайдера не удалось — уберите приложение в настройках аккаунта",
  };
}

/** «Вставить ссылку» на «Файлах»: название + любой https-адрес, без обращения к API дисков. */
export async function attachCloudLinkAction(
  projectId: string,
  input: { name: string; url: string },
): Promise<CloudActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("project:write") && !ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name) return { error: "Укажите название" };
  if (name.length > MAX_LINK_NAME_LENGTH) {
    return { error: `Название — не длиннее ${MAX_LINK_NAME_LENGTH} символов` };
  }
  const link = parseCloudLink(typeof input?.url === "string" ? input.url : "");
  if ("error" in link) return { error: link.error };

  const created = await prisma.cloudFileLink.create({
    data: {
      projectId,
      provider: link.provider,
      externalId: link.externalId,
      name,
      webUrl: link.url,
    },
    select: { id: true },
  });
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.cloudFileLink,
    entityId: created.id,
    action: "CREATE",
    summary: `Прикреплена ссылка «${name}» (${link.provider ? cloudProviderLabels[link.provider] : linkSiteLabel(link.url)})`,
  });

  revalidatePath(`/ru/projects/${projectId}/files`);
  return { success: "Ссылка прикреплена" };
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
