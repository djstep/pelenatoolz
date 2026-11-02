import "server-only";

import { MembershipStatus, ProjectDriveStatus, type ProjectDrive } from "@prisma/client";
import { revokeTokensUnlessShared, type RevokeOutcome } from "@/features/cloud/lib/cloud-service";
import { CloudReconnectRequiredError, isCloudReconnectRequiredError } from "@/features/cloud/lib/errors";
import { refreshGoogleToken } from "@/features/cloud/lib/google-drive";
import { cloudConnectRefusal, type CloudConnectRefusal } from "@/features/cloud/lib/oauth-access";
import {
  canManageProjectDrive,
  keeperStillValid,
  PROJECT_DRIVE_DETACH_REASON,
  projectDriveCleanSlate,
  type ProjectDriveActor,
} from "@/features/cloud/lib/project-drive-rules";
import type { ProviderAccount } from "@/features/cloud/lib/revoke-rule";
import { decryptSecret, encryptSecret } from "@/features/cloud/lib/token-crypto";
import { lockProjectOwner } from "@/features/projects/lib/owner";
import { isProducerRole } from "@/features/roles/role-rules";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMemberName } from "@/shared/audit/member-name";
import { auditMutation, recordAudit } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

type TransactionCallback = Extract<
  Parameters<typeof prisma.$transaction>[0],
  (client: never) => Promise<unknown>
>;
/** Транзакция базы. */
type Tx = TransactionCallback extends (client: infer T) => Promise<unknown> ? T : never;

/** Токены отключённого / заменённого диска — отозвать после транзакции (`revokeProjectDriveTokens`). */
export type ReleasedDriveTokens = ProviderAccount & {
  accessToken: string | null;
  refreshToken: string | null;
};

function releasedTokens(drive: ProjectDrive): ReleasedDriveTokens | null {
  if (!drive.accessToken && !drive.refreshToken) return null;
  return {
    provider: drive.provider,
    accountSubject: drive.accountSubject,
    accountEmail: drive.accountEmail,
    accessToken: drive.accessToken,
    refreshToken: drive.refreshToken,
  };
}

/** Отключённый диск: токены стёрты, система диском больше не управляет. Почта аккаунта остаётся для истории. */
function detachedFields(reason: string) {
  return {
    status: ProjectDriveStatus.DETACHED,
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    needsReconnectAt: null,
    detachedAt: new Date(),
    detachReason: reason,
  };
}

/**
 * Отзыв токенов у Google — после транзакции и только если аккаунт больше нигде в системе
 * не подключён (`revokeTokensUnlessShared`). Не бросает.
 */
export async function revokeProjectDriveTokens(
  tokens: ReleasedDriveTokens | null,
): Promise<RevokeOutcome | null> {
  return tokens ? revokeTokensUnlessShared(tokens) : null;
}

/** Состояние диска для проверки прав (authorize, callback, окна). */
export async function getProjectDriveState(projectId: string) {
  return prisma.projectDrive.findUnique({
    where: { projectId },
    select: { status: true, keeperMembershipId: true },
  });
}

/** Раздел «Диск проекта» в настройках и плашка: почта аккаунта, хранитель, когда подключён. */
export async function getProjectDriveView(projectId: string) {
  const drive = await prisma.projectDrive.findUnique({
    where: { projectId },
    select: {
      status: true,
      accountEmail: true,
      connectedAt: true,
      detachedAt: true,
      detachReason: true,
      needsReconnectAt: true,
      keeperMembershipId: true,
      keeperMembership: { select: { user: { select: { name: true } } } },
    },
  });
  if (!drive) return null;
  return {
    status: drive.status,
    accountEmail: drive.accountEmail,
    connectedAt: drive.connectedAt,
    detachedAt: drive.detachedAt,
    detachReason: drive.detachReason,
    needsReconnect: drive.needsReconnectAt != null,
    keeperMembershipId: drive.keeperMembershipId,
    keeperName: drive.keeperMembership ? auditMemberName(drive.keeperMembership.user.name) : null,
  };
}

export type ProjectDriveView = NonNullable<Awaited<ReturnType<typeof getProjectDriveView>>>;

/** Участие человека в проекте под блокировкой — для повторной проверки прав внутри транзакции. */
async function activeMembership(tx: Tx, projectId: string, userId: string) {
  return tx.projectMembership.findFirst({
    where: { projectId, userId, status: MembershipStatus.ACTIVE },
    include: { role: true, user: { select: { name: true } } },
  });
}

/**
 * Сохранить диск проекта после окна согласия Google. Под блокировкой проекта (как смена ролей и
 * удаление участников) ещё раз проверяется участие и право: пока человек был в окне Google,
 * его могли удалить или понизить. Подключивший становится хранителем.
 * Замена другим аккаунтом / после отключения — с чистого листа: папки диска (и выгрузки, доступы
 * в них — каскадом) отвязываются; файлы на старом диске остаются у старого хранителя.
 */
export async function saveProjectDrive(input: {
  projectId: string;
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scopes: string;
  accountEmail: string | null;
  accountSubject: string | null;
}): Promise<{ error: CloudConnectRefusal } | { released: ReleasedDriveTokens | null }> {
  const { projectId, userId } = input;
  return prisma.$transaction(async (tx) => {
    const ownerUserId = await lockProjectOwner(tx, projectId);
    const membership = await activeMembership(tx, projectId, userId);
    const existing = await tx.projectDrive.findUnique({ where: { projectId } });
    const refusal = cloudConnectRefusal({
      purpose: "project",
      projectId,
      userId,
      project: membership
        ? { ownerUserId, role: membership.role, membershipId: membership.id, drive: existing }
        : null,
    });
    if (refusal || !membership) return { error: refusal ?? "not_member" };

    const cleanSlate = projectDriveCleanSlate(existing, input.accountSubject);
    const kind = !existing || existing.status !== ProjectDriveStatus.ACTIVE
      ? "connect"
      : cleanSlate
        ? "replace"
        : "reconnect";
    const keeperName = auditMemberName(membership.user.name);
    const fields = {
      provider: "GOOGLE_DRIVE" as const,
      keeperMembershipId: membership.id,
      accountEmail: input.accountEmail,
      accountSubject: input.accountSubject,
      accessToken: encryptSecret(input.accessToken),
      refreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : null,
      expiresAt: input.expiresIn ? new Date(Date.now() + input.expiresIn * 1000) : null,
      scopes: input.scopes,
      needsReconnectAt: null,
      status: ProjectDriveStatus.ACTIVE,
      detachedAt: null,
      detachReason: null,
      connectedAt: new Date(),
    };

    // Без почт: в журнале хранитель (имя), права, сменился ли аккаунт и сколько папок отвязано.
    await auditMutation(
      { user: { id: userId } },
      async () => {
        let unlinked = 0;
        if (existing && cleanSlate) {
          ({ count: unlinked } = await tx.driveFolder.deleteMany({
            where: { projectDriveId: existing.id },
          }));
        }
        const saved = await tx.projectDrive.upsert({
          where: { projectId },
          create: { projectId, ...fields },
          update: {
            ...fields,
            // Google присылает refresh-токен только при согласии; без него оставляем прежний того же аккаунта.
            refreshToken: input.refreshToken
              ? fields.refreshToken
              : cleanSlate
                ? null
                : undefined,
          },
        });
        return { unlinked, driveId: saved.id };
      },
      null,
      {
        projectId,
        entityType: AuditEntityType.projectDrive,
        entityId: (_input, result) => result.driveId,
        action: existing ? "UPDATE" : "CREATE",
        summary: (_input, { unlinked }) =>
          kind === "replace"
            ? `Диск проекта заменён (Google Диск), хранитель «${keeperName}»` +
              (unlinked > 0 ? ` — прежние папки отвязаны: ${unlinked}` : "")
            : kind === "reconnect"
              ? `Диск проекта переподключён (Google Диск), хранитель «${keeperName}»`
              : `Подключён диск проекта (Google Диск), хранитель «${keeperName}»`,
        changes: (_input, { unlinked }) => ({
          kind,
          provider: "GOOGLE_DRIVE",
          scopes: input.scopes,
          keeperMembershipId: membership.id,
          keeperName,
          ...(existing && existing.accountSubject !== input.accountSubject
            ? { accountChanged: true }
            : {}),
          ...(unlinked > 0 ? { foldersUnlinked: unlinked } : {}),
        }),
      },
      { db: tx },
    );

    // Прежние токены активного диска — отозвать после транзакции (если аккаунт больше не нужен).
    const released =
      existing && existing.status === ProjectDriveStatus.ACTIVE ? releasedTokens(existing) : null;
    return { released };
  });
}

/** Отключить диск проекта руками — хранитель или владелец. Токены отзываются после (`revokeProjectDriveTokens`). */
export async function disconnectProjectDrive(
  projectId: string,
  userId: string,
): Promise<{ error: string } | { released: ReleasedDriveTokens | null }> {
  return prisma.$transaction(async (tx) => {
    const ownerUserId = await lockProjectOwner(tx, projectId);
    const membership = await activeMembership(tx, projectId, userId);
    const drive = await tx.projectDrive.findUnique({
      where: { projectId },
      include: { keeperMembership: { select: { user: { select: { name: true } } } } },
    });
    if (!drive || drive.status !== ProjectDriveStatus.ACTIVE) {
      return { error: "Диск проекта не подключён" };
    }
    const actor = {
      userId,
      membershipId: membership?.id ?? null,
      isProducer: membership ? isProducerRole(membership.role) : false,
      ownerUserId,
    };
    if (!canManageProjectDrive(actor, drive)) {
      return { error: "Отключить диск проекта может его хранитель или владелец проекта" };
    }
    const keeperName = auditMemberName(drive.keeperMembership?.user.name);
    await auditMutation(
      { user: { id: userId } },
      () =>
        tx.projectDrive.update({
          where: { id: drive.id },
          data: detachedFields(PROJECT_DRIVE_DETACH_REASON.disconnected),
        }),
      null,
      {
        projectId,
        entityType: AuditEntityType.projectDrive,
        entityId: drive.id,
        action: "UPDATE",
        summary: `Диск проекта отключён (хранитель «${keeperName}»)`,
        changes: {
          status: { from: "ACTIVE", to: "DETACHED" },
          reason: PROJECT_DRIVE_DETACH_REASON.disconnected,
          keeperName,
        },
      },
      { db: tx },
    );
    return { released: releasedTokens(drive) };
  });
}

/**
 * Хранитель перестал быть активным продюсером (удалён, сменили роль) — в той же транзакции, что
 * и изменение участия: диск проекта → «отключён», токены стираются, запись в журнал.
 * Вызывать после изменения участия. Возвращает токены — отозвать после транзакции.
 * Передача владения сюда не ведёт: бывший владелец остаётся продюсером.
 */
export async function detachProjectDriveIfKeeperLeft(
  tx: Tx,
  input: { projectId: string; membershipId: string; actorUserId: string },
): Promise<ReleasedDriveTokens | null> {
  const drive = await tx.projectDrive.findFirst({
    where: {
      projectId: input.projectId,
      status: ProjectDriveStatus.ACTIVE,
      keeperMembershipId: input.membershipId,
    },
  });
  if (!drive) return null;
  const membership = await tx.projectMembership.findFirst({
    where: { id: input.membershipId, projectId: input.projectId },
    include: { role: true, user: { select: { name: true } } },
  });
  const stillKeeper = keeperStillValid(
    membership && {
      active: membership.status === MembershipStatus.ACTIVE,
      isProducer: isProducerRole(membership.role),
    },
  );
  if (stillKeeper) return null;

  const keeperName = auditMemberName(membership?.user.name);
  await auditMutation(
    { user: { id: input.actorUserId } },
    () =>
      tx.projectDrive.update({
        where: { id: drive.id },
        data: detachedFields(PROJECT_DRIVE_DETACH_REASON.keeperLeft),
      }),
    null,
    {
      projectId: input.projectId,
      entityType: AuditEntityType.projectDrive,
      entityId: drive.id,
      action: "UPDATE",
      summary: `Диск проекта отключён: хранитель «${keeperName}» больше не продюсер`,
      changes: {
        status: { from: "ACTIVE", to: "DETACHED" },
        reason: PROJECT_DRIVE_DETACH_REASON.keeperLeft,
        keeperMembershipId: input.membershipId,
        keeperName,
      },
    },
    { db: tx },
  );
  return releasedTokens(drive);
}

/**
 * Диск проекта: доступ отозван у Google (`invalid_grant`, 401) — пометка «нужно переподключить»
 * и запись в журнал один раз; повторные ошибки записей не множат.
 */
export async function markProjectDriveNeedsReconnect(
  drive: Pick<ProjectDrive, "id" | "projectId">,
  actorUserId: string,
) {
  const { count } = await prisma.projectDrive.updateMany({
    where: { id: drive.id, status: ProjectDriveStatus.ACTIVE, needsReconnectAt: null },
    data: { needsReconnectAt: new Date() },
  });
  if (count === 0) return;
  await recordAudit(
    { user: { id: actorUserId } },
    {
      projectId: drive.projectId,
      entityType: AuditEntityType.projectDrive,
      entityId: drive.id,
      action: "UPDATE",
      summary: "Диск проекта: доступ отозван у Google — нужно переподключить",
      changes: { needsReconnect: true },
    },
  );
}

/**
 * Действующий токен диска проекта. `forceRefresh` — обновить, даже если не истёк (проверка доступа).
 * Доступ отозван — пометка «переподключить» и `CloudReconnectRequiredError` (без падения выше).
 */
export async function getProjectDriveAccessToken(
  projectId: string,
  actorUserId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  const drive = await prisma.projectDrive.findUnique({ where: { projectId } });
  if (!drive || drive.status !== ProjectDriveStatus.ACTIVE || !drive.accessToken) {
    throw new Error("Диск проекта не подключён");
  }
  if (drive.needsReconnectAt) throw new CloudReconnectRequiredError(drive.provider);

  const accessToken = decryptSecret(drive.accessToken);
  const expiresSoon = drive.expiresAt != null && drive.expiresAt.getTime() - Date.now() < 60_000;
  if ((!expiresSoon && !options.forceRefresh) || !drive.refreshToken) return accessToken;

  let refreshed;
  try {
    refreshed = await refreshGoogleToken(decryptSecret(drive.refreshToken));
  } catch (e) {
    if (isCloudReconnectRequiredError(e)) await markProjectDriveNeedsReconnect(drive, actorUserId);
    throw e;
  }
  // Только если диск всё ещё тот же и активен: отключённый за это время не оживляем.
  await prisma.projectDrive.updateMany({
    where: { id: drive.id, status: ProjectDriveStatus.ACTIVE, accessToken: drive.accessToken },
    data: {
      accessToken: encryptSecret(refreshed.access_token),
      refreshToken: refreshed.refresh_token ? encryptSecret(refreshed.refresh_token) : undefined,
      expiresAt: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null,
    },
  });
  return refreshed.access_token;
}

/** Запрос к диску проекта с действующим токеном; ответ «доступ отозван» помечает диск (шаги 5–6). */
export async function withProjectDriveAccessToken<T>(
  projectId: string,
  actorUserId: string,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const token = await getProjectDriveAccessToken(projectId, actorUserId);
  try {
    return await fn(token);
  } catch (e) {
    if (isCloudReconnectRequiredError(e)) {
      const drive = await prisma.projectDrive.findUnique({
        where: { projectId },
        select: { id: true, projectId: true },
      });
      if (drive) await markProjectDriveNeedsReconnect(drive, actorUserId);
    }
    throw e;
  }
}

/** Кто смотрит / действует — из проверенного контекста проекта (`requireProjectContext`). */
export function projectDriveActor(ctx: {
  user: { id?: string | null };
  membership: { id: string };
  role: { isSystem: boolean; name: string };
  project: { ownerUserId: string | null };
}): ProjectDriveActor {
  return {
    userId: ctx.user.id ?? "",
    membershipId: ctx.membership.id,
    isProducer: isProducerRole(ctx.role),
    ownerUserId: ctx.project.ownerUserId,
  };
}
