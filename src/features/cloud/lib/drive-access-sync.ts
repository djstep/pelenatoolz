import "server-only";

import { MembershipStatus, ProjectDriveStatus, type DriveFolderGrant } from "@prisma/client";
import { after } from "next/server";
import {
  assertShareableFolderKey,
  COMMON_FOLDER_NAME,
  departmentIdFromFolderKey,
  desiredFolderGrants,
  diffFolderGrants,
  DRIVE_GRANT_NOTIFY,
  DRIVE_GRANT_ROLE,
  isKnownGoogleEmail,
  isShareableFolderKey,
  PROJECT_FOLDER_KEYS,
  type AccessFolder,
  type FolderPermission,
  type GrantOp,
} from "@/features/cloud/lib/drive-access-rules";
import { isCloudApiError, isCloudReconnectRequiredError } from "@/features/cloud/lib/errors";
import {
  createDrivePermission,
  deleteDrivePermission,
  listDrivePermissions,
} from "@/features/cloud/lib/google-drive-api";
import { withProjectDriveAccessToken } from "@/features/cloud/lib/project-drive-service";
import { hasPermission } from "@/features/memberships/permissions";
import { parsePermissionMatrix } from "@/features/roles/permissions-matrix";
import { isProducerRole } from "@/features/roles/role-rules";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMemberName } from "@/shared/audit/member-name";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

/**
 * Доступы к папкам диска проекта (Google): пересчёт «кому какая папка» и выдача / снятие
 * «комментатора». Трогаются только выдачи системы (`DriveFolderGrant` с `permissionId`); доступы,
 * выданные хранителем руками, — никогда. Только уже созданные папки: папки создаются при первой
 * выгрузке (`ensureProjectDriveFolder`). Ошибка Google действие в системе не ломает — остаётся
 * строкой «не синхронизировано» у продюсеров.
 */

/** Что вызвало пересчёт — в журнал. */
export type DriveSyncTrigger =
  | "manual"
  | "retry"
  | "member_role"
  | "member_removed"
  | "member_joined"
  | "role_permissions"
  | "department_heads"
  | "department_deleted"
  | "google_email"
  | "drive_connected"
  | "folder_created";

export type DriveSyncResult = {
  /** skipped — диска нет / отключён / папок ещё нет; reconnect — доступ к диску отозван. */
  status: "ok" | "partial" | "skipped" | "reconnect";
  added: number;
  removed: number;
  regranted: number;
  failed: number;
  /** Сколько выдач после пересчёта не синхронизировано (ждут или с ошибкой). */
  pending: number;
};

/**
 * Время одного пересчёта. Функция Vercel живёт ограниченное время (`after()` — в его пределах),
 * а выдача доступа — по одному запросу на человека: что не успели — остаётся «не синхронизировано».
 */
const SYNC_BUDGET_MS = 40_000;
/** Сколько раз пробовать один запрос при лимите частоты / 5xx / сети. */
const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 1_000;
/** Сколько раз пересчитать «нужно» заново, если за время пересчёта что-то поменялось. */
const MAX_PASSES = 3;

const RATE_LIMIT_REASONS = new Set(["sharingRateLimitExceeded", "userRateLimitExceeded", "rateLimitExceeded"]);

const RECONNECT_TEXT = "Доступ к диску проекта отозван — нужно переподключить";
const FOLDER_GONE_TEXT = "Папку удалили на диске — создастся заново при следующей выгрузке";
const OUT_OF_TIME_TEXT = "Не успели за один раз — нажмите «Повторить»";

/** Вне production время пересчёта можно уменьшить (`DRIVE_SYNC_BUDGET_MS`). */
function syncBudgetMs(): number {
  if (process.env.NODE_ENV !== "production") {
    const raw = Number(process.env.DRIVE_SYNC_BUDGET_MS);
    if (Number.isInteger(raw) && raw >= 1_000 && raw <= SYNC_BUDGET_MS) return raw;
  }
  return SYNC_BUDGET_MS;
}

class SyncOutOfTimeError extends Error {
  constructor(readonly last: unknown = null) {
    super(OUT_OF_TIME_TEXT);
    this.name = "SyncOutOfTimeError";
  }
}

function isRetryable(e: unknown) {
  if (!isCloudApiError(e)) return false;
  return (
    e.status === 0 ||
    e.status === 429 ||
    e.status >= 500 ||
    (e.reason != null && RATE_LIMIT_REASONS.has(e.reason))
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Лимит частоты, 5xx, сеть — повтор с паузой 1, 2, 4 с; не успеваем до конца времени — `SyncOutOfTimeError`. */
async function withRetry<T>(fn: () => Promise<T>, deadline: number): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    if (Date.now() >= deadline) throw new SyncOutOfTimeError();
    try {
      return await fn();
    } catch (e) {
      if (!isRetryable(e) || attempt >= MAX_ATTEMPTS) throw e;
      const wait = BACKOFF_BASE_MS * 2 ** (attempt - 1);
      if (Date.now() + wait >= deadline) throw new SyncOutOfTimeError(e);
      await sleep(wait);
    }
  }
}

function isFolderGone(e: unknown) {
  return isCloudApiError(e) && e.status === 404;
}

/** Текст ошибки для строки «не синхронизировано»: только наши тексты, без ответа Google (там бывают почты). */
function errorText(e: unknown): string {
  if (e instanceof SyncOutOfTimeError) {
    return isCloudApiError(e.last) ? `${e.last.message}. ${OUT_OF_TIME_TEXT}` : OUT_OF_TIME_TEXT;
  }
  if (isFolderGone(e)) return FOLDER_GONE_TEXT;
  if (isCloudApiError(e)) return e.message;
  return "Не удалось выдать доступ — нажмите «Повторить»";
}

// ---------- данные ----------

/** Папки диска проекта, которым выдаётся доступ (только «Общая» и папки цехов — риск 9). */
async function shareableFolders(projectId: string, driveId: string, folderIds?: readonly string[]) {
  const rows = await prisma.driveFolder.findMany({
    where: {
      projectId,
      projectDriveId: driveId,
      ...(folderIds ? { id: { in: [...folderIds] } } : {}),
    },
    select: { id: true, key: true, departmentId: true, externalId: true },
  });
  return rows.filter((f) => isShareableFolderKey(f.key));
}

/** Кто есть в проекте сейчас: участники, их роли и почты, главы цехов. */
async function loadPeople(projectId: string) {
  const [memberships, heads] = await Promise.all([
    prisma.projectMembership.findMany({
      where: { projectId },
      select: {
        id: true,
        userId: true,
        status: true,
        role: { select: { isSystem: true, name: true, permissions: true } },
        user: { select: { email: true, googleEmail: true } },
      },
    }),
    prisma.departmentHead.findMany({
      where: { department: { projectId } },
      select: { departmentId: true, membershipId: true },
    }),
  ]);
  const members = memberships.map((m) => {
    const matrix = parsePermissionMatrix(m.role.permissions);
    return {
      userId: m.userId,
      membershipId: m.id,
      status: m.status,
      isProducer: isProducerRole(m.role),
      // «КПП и вызывные: просмотр» — как `canReadCallSheet`.
      canReadCallSheets: hasPermission(matrix, "callsheet:read") || hasPermission(matrix, "schedule:read"),
      email: m.user.email,
      googleEmail: m.user.googleEmail,
    };
  });
  return { members, heads };
}

type Folder = AccessFolder & { externalId: string };

/** Доступы папок у Google. Папку удалили (404) — её выдачи умерли вместе с ней. */
async function readFolderPermissions(
  accessToken: string,
  folders: readonly Folder[],
  deadline: number,
): Promise<{ google: Map<string, FolderPermission[]>; gone: Set<string> }> {
  const google = new Map<string, FolderPermission[]>();
  const gone = new Set<string>();
  for (const folder of folders) {
    try {
      const list = await withRetry(() => listDrivePermissions(accessToken, folder.externalId), deadline);
      google.set(
        folder.id,
        list.filter((p) => p.role !== "owner").map((p) => ({ id: p.id, email: p.email })),
      );
    } catch (e) {
      if (isCloudReconnectRequiredError(e) || e instanceof SyncOutOfTimeError) throw e;
      if (isFolderGone(e)) gone.add(folder.id);
      // Иная ошибка — Google не спросили, строкам базы верим как есть.
    }
  }
  return { google, gone };
}

// ---------- выполнение ----------

type Stats = {
  added: number;
  removed: number;
  regranted: number;
  failed: number;
  errors: Set<string>;
  /** Что уже не удалось в этом пересчёте — следующий проход его не повторяет. */
  failedKeys: Set<string>;
};

const pairKey = (folderId: string, userId: string) => `${folderId} ${userId}`;

function opKey(op: GrantOp) {
  return op.kind === "add" || op.kind === "regrant" ? pairKey(op.folderId, op.userId) : op.grantId;
}

/** Отметить заранее всё, что будем делать: что не успеем — останется видно «не синхронизировано». */
async function premark(ops: readonly GrantOp[]) {
  for (const op of ops) {
    if (op.kind === "add") {
      await prisma.driveFolderGrant.upsert({
        where: { folderId_userId: { folderId: op.folderId, userId: op.userId } },
        create: {
          folderId: op.folderId,
          userId: op.userId,
          email: op.email,
          role: DRIVE_GRANT_ROLE,
          status: "PENDING_ADD",
        },
        update: { email: op.email, role: DRIVE_GRANT_ROLE, permissionId: null, status: "PENDING_ADD", lastError: null },
      });
    } else if (op.kind === "regrant") {
      await prisma.driveFolderGrant.update({
        where: { id: op.grantId },
        data: { status: "PENDING_ADD", lastError: null },
      });
    } else if (op.kind === "remove") {
      await prisma.driveFolderGrant.update({
        where: { id: op.grantId },
        data: { status: "PENDING_REMOVE", lastError: null },
      });
    }
  }
}

async function failGrant(where: { id: string } | { folderId: string; userId: string }, e: unknown, stats: Stats) {
  const text = errorText(e);
  const outOfTime = e instanceof SyncOutOfTimeError;
  if (!outOfTime) stats.failed++;
  stats.errors.add(text);
  stats.failedKeys.add("id" in where ? where.id : pairKey(where.folderId, where.userId));
  const status = outOfTime ? undefined : ("FAILED" as const);
  if ("id" in where) {
    await prisma.driveFolderGrant.updateMany({ where: { id: where.id }, data: { status, lastError: text } });
  } else {
    await prisma.driveFolderGrant.updateMany({ where, data: { status, lastError: text } });
  }
}

/**
 * Выдать «комментатора» на почту. Единственное место, где система выдаёт доступ у Google:
 * перед запросом — проверка, что папка конечная (риск 9).
 */
async function grantFolderAccess(accessToken: string, folder: Folder, email: string, deadline: number) {
  assertShareableFolderKey(folder.key);
  return withRetry(
    () =>
      createDrivePermission(accessToken, folder.externalId, {
        email,
        role: DRIVE_GRANT_ROLE,
        sendNotificationEmail: DRIVE_GRANT_NOTIFY,
      }),
    deadline,
  );
}

async function revokeFolderAccess(accessToken: string, folder: Folder, permissionId: string, deadline: number) {
  return withRetry(() => deleteDrivePermission(accessToken, folder.externalId, permissionId), deadline);
}

/** Одно действие. Ошибка Google — строка FAILED; не успели — `SyncOutOfTimeError` выше; отозван — выше. */
async function applyOp(
  accessToken: string,
  op: GrantOp,
  folders: ReadonlyMap<string, Folder>,
  deadline: number,
  stats: Stats,
) {
  if (op.kind === "drop") {
    await prisma.driveFolderGrant.deleteMany({ where: { id: op.grantId } });
    return;
  }
  if (op.kind === "markOk") {
    await prisma.driveFolderGrant.updateMany({
      where: { id: op.grantId },
      data: { status: "OK", lastError: null },
    });
    return;
  }
  const folder = folders.get(op.folderId);
  if (!folder) return;
  const pair = op.kind === "remove" ? { id: op.grantId } : { folderId: op.folderId, userId: op.userId };
  try {
    if (op.kind === "remove") {
      await revokeFolderAccess(accessToken, folder, op.permissionId, deadline);
      await prisma.driveFolderGrant.deleteMany({ where: { id: op.grantId } });
      stats.removed++;
      return;
    }
    if (op.kind === "regrant" && op.oldPermissionId) {
      await revokeFolderAccess(accessToken, folder, op.oldPermissionId, deadline);
    }
    if (op.kind === "regrant") {
      await prisma.driveFolderGrant.updateMany({
        where: { id: op.grantId },
        data: { email: op.email, permissionId: null },
      });
    }
    const { permissionId } = await grantFolderAccess(accessToken, folder, op.email, deadline);
    await prisma.driveFolderGrant.updateMany({
      where: { folderId: op.folderId, userId: op.userId },
      data: { email: op.email, permissionId, status: "OK", lastError: null },
    });
    if (op.kind === "regrant") stats.regranted++;
    else stats.added++;
  } catch (e) {
    if (isCloudReconnectRequiredError(e)) throw e;
    await failGrant(pair, e, stats);
    if (e instanceof SyncOutOfTimeError) throw e;
  }
}

/**
 * Выдачи этих папок, ждущие синхронизации, — отметить причиной. `onlyUnexplained` — не трогать
 * строки, у которых уже есть своя ошибка (не успели — ошибка Google важнее).
 */
async function markPending(folderIds: readonly string[], text: string, onlyUnexplained = false) {
  await prisma.driveFolderGrant.updateMany({
    where: {
      folderId: { in: [...folderIds] },
      status: { not: "OK" },
      ...(onlyUnexplained ? { lastError: null } : {}),
    },
    data: { lastError: text },
  });
}

const EMPTY: DriveSyncResult = { status: "skipped", added: 0, removed: 0, regranted: 0, failed: 0, pending: 0 };

const TRIGGER_TEXT: Record<DriveSyncTrigger, string> = {
  manual: "по кнопке",
  retry: "повтор",
  member_role: "смена роли участника",
  member_removed: "удаление участника",
  member_joined: "участник принял приглашение",
  role_permissions: "изменены права роли",
  department_heads: "изменены главы цеха",
  department_deleted: "удалён цех",
  google_email: "изменена «Почта для Google»",
  drive_connected: "подключение диска проекта",
  folder_created: "создана папка",
};

/**
 * Пересчитать доступы к папкам диска проекта и привести выдачи системы к нужным.
 * `folderIds` — только эти папки (кнопка «Повторить», новая папка). `deadline` — общий предел
 * (пересчёт по нескольким проектам). Не бросает из-за Google: итог — в ответе и в журнале.
 */
export async function syncProjectDriveAccess(
  projectId: string,
  options: {
    actorUserId: string;
    trigger: DriveSyncTrigger;
    folderIds?: readonly string[];
    deadline?: number;
  },
): Promise<DriveSyncResult> {
  const drive = await prisma.projectDrive.findUnique({
    where: { projectId },
    select: { id: true, status: true, needsReconnectAt: true, accountEmail: true },
  });
  if (!drive || drive.status !== ProjectDriveStatus.ACTIVE) return EMPTY;
  const deadline = options.deadline ?? Date.now() + syncBudgetMs();
  const initialFolders = await shareableFolders(projectId, drive.id, options.folderIds);
  if (initialFolders.length === 0) return EMPTY;
  const folderIds = initialFolders.map((f) => f.id);

  const stats: Stats = { added: 0, removed: 0, regranted: 0, failed: 0, errors: new Set(), failedKeys: new Set() };
  let status: DriveSyncResult["status"] = "ok";

  if (drive.needsReconnectAt) {
    status = "reconnect";
    await markPending(folderIds, RECONNECT_TEXT);
  } else {
    try {
      await withProjectDriveAccessToken(projectId, options.actorUserId, async (accessToken) => {
        for (let pass = 0; pass < MAX_PASSES; pass++) {
          // Каждый проход — заново из базы: за время запросов к Google люди и роли могли поменяться.
          const folders = await shareableFolders(projectId, drive.id, folderIds);
          const byId = new Map(folders.map((f) => [f.id, f]));
          const { google, gone } = await readFolderPermissions(accessToken, folders, deadline);
          if (gone.size > 0) {
            // Папку удалили руками: её доступов больше нет; создастся заново при выгрузке.
            await prisma.driveFolderGrant.deleteMany({ where: { folderId: { in: [...gone] } } });
          }
          const live = folders.filter((f) => !gone.has(f.id));
          const { members, heads } = await loadPeople(projectId);
          const desired = desiredFolderGrants({
            folders: live,
            members,
            departmentHeads: heads,
            driveAccountEmail: drive.accountEmail,
          });
          const stored = await prisma.driveFolderGrant.findMany({
            where: { folderId: { in: live.map((f) => f.id) } },
            select: { id: true, folderId: true, userId: true, email: true, permissionId: true, status: true },
          });
          const ops = diffFolderGrants({ desired, stored, google }).filter(
            (op) => !stats.failedKeys.has(opKey(op)),
          );
          if (ops.length === 0) return;
          await premark(ops);
          for (const op of ops) await applyOp(accessToken, op, byId, deadline, stats);
        }
      });
    } catch (e) {
      if (isCloudReconnectRequiredError(e)) {
        // Диск уже помечен «нужно переподключить» (`withProjectDriveAccessToken`).
        status = "reconnect";
        await markPending(folderIds, RECONNECT_TEXT);
      } else if (e instanceof SyncOutOfTimeError) {
        status = "partial";
        await markPending(folderIds, OUT_OF_TIME_TEXT, true);
      } else if (isCloudApiError(e)) {
        status = "partial";
        stats.errors.add(e.message);
        await markPending(folderIds, e.message);
      } else {
        throw e;
      }
    }
  }

  const pending = await prisma.driveFolderGrant.count({
    where: { folderId: { in: folderIds }, status: { not: "OK" } },
  });
  if (status === "ok" && (pending > 0 || stats.failed > 0)) status = "partial";
  const result: DriveSyncResult = {
    status,
    added: stats.added,
    removed: stats.removed,
    regranted: stats.regranted,
    failed: stats.failed,
    pending,
  };

  const changed = result.added + result.removed + result.regranted > 0;
  const explicit = options.trigger === "manual" || options.trigger === "retry";
  if (changed || explicit || status !== "ok") {
    await auditDriveSync(projectId, drive.id, options, result, [...stats.errors]);
  }
  return result;
}

/** Журнал: итог пересчёта и ошибки — только счётчики и наши тексты, без почт. */
async function auditDriveSync(
  projectId: string,
  driveId: string,
  options: { actorUserId: string; trigger: DriveSyncTrigger },
  result: DriveSyncResult,
  errors: string[],
) {
  const counts = [
    result.added ? `выдано ${result.added}` : null,
    result.regranted ? `перевыдано ${result.regranted}` : null,
    result.removed ? `снято ${result.removed}` : null,
  ].filter(Boolean);
  const summary =
    result.status === "reconnect"
      ? "Доступы к папкам диска проекта не синхронизированы: доступ к диску отозван — нужно переподключить"
      : result.status === "partial"
        ? `Ошибка синхронизации доступов к папкам диска проекта: не синхронизировано ${result.pending}` +
          (counts.length ? ` (${counts.join(", ")})` : "")
        : `Доступы к папкам диска проекта синхронизированы${counts.length ? `: ${counts.join(", ")}` : " — изменений нет"}`;
  try {
    await auditMutation(
      { user: { id: options.actorUserId } },
      async () => result,
      null,
      {
        projectId,
        entityType: AuditEntityType.projectDrive,
        entityId: driveId,
        action: "UPDATE",
        summary,
        changes: {
          accessSync: true,
          trigger: options.trigger,
          triggerText: TRIGGER_TEXT[options.trigger],
          status: result.status,
          added: result.added,
          regranted: result.regranted,
          removed: result.removed,
          failed: result.failed,
          pending: result.pending,
          ...(errors.length ? { errors } : {}),
        },
      },
    );
  } catch (e) {
    console.error("[drive access sync] audit", e instanceof Error ? e.message : e);
  }
}

// ---------- пересчёт после действия в системе ----------

function logSyncError(scope: string, e: unknown) {
  console.error(`[drive access sync] ${scope}`, e instanceof Error ? e.message : e);
}

/**
 * Пересчитать доступы после ответа пользователю (`after()`): ответ не ждёт Google.
 * Диска нет или папки ещё не созданы — запросов к Google нет.
 */
export function scheduleProjectDriveAccessSync(
  projectId: string,
  actorUserId: string,
  trigger: DriveSyncTrigger,
) {
  after(async () => {
    try {
      await syncProjectDriveAccess(projectId, { actorUserId, trigger });
    } catch (e) {
      logSyncError(projectId, e);
    }
  });
}

/** Смена «Почты для Google»: пересчёт во всех проектах человека с активным диском и папками. */
export function scheduleUserDriveAccessSync(userId: string, trigger: DriveSyncTrigger) {
  after(async () => {
    const deadline = Date.now() + syncBudgetMs();
    try {
      const drives = await prisma.projectDrive.findMany({
        where: {
          status: ProjectDriveStatus.ACTIVE,
          folders: { some: {} },
          project: { memberships: { some: { userId, status: MembershipStatus.ACTIVE } } },
        },
        select: { projectId: true },
      });
      for (const { projectId } of drives) {
        if (Date.now() >= deadline) break;
        try {
          await syncProjectDriveAccess(projectId, { actorUserId: userId, trigger, deadline });
        } catch (e) {
          logSyncError(projectId, e);
        }
      }
    } catch (e) {
      logSyncError(`user ${userId}`, e);
    }
  });
}

// ---------- раздел «Диск проекта» ----------

export type UnsyncedDriveGrant = {
  id: string;
  /** Имя участника. */
  name: string;
  /** Почта — только продюсерам (раздел виден только им). */
  email: string;
  folder: string;
  action: "add" | "remove";
  reason: string;
  notGoogleEmail: boolean;
};

export type DriveAccessOverview = {
  folders: number;
  granted: number;
  unsynced: UnsyncedDriveGrant[];
};

function folderLabel(folder: { key: string; department: { name: string } | null }) {
  if (folder.key === PROJECT_FOLDER_KEYS.common) return COMMON_FOLDER_NAME;
  if (departmentIdFromFolderKey(folder.key)) {
    return folder.department ? `Цех «${folder.department.name}»` : "Удалённый цех";
  }
  return folder.key;
}

function pendingReason(row: Pick<DriveFolderGrant, "status" | "lastError">) {
  if (row.lastError) return row.lastError;
  if (row.status === "PENDING_REMOVE") return "Ожидает снятия доступа";
  if (row.status === "PENDING_ADD") return "Ожидает выдачи доступа";
  return "Ошибка — нажмите «Повторить»";
}

/** Для раздела «Диск проекта» (продюсерам): сколько папок, сколько выдано, что не синхронизировано. */
export async function getDriveAccessOverview(projectId: string): Promise<DriveAccessOverview | null> {
  const drive = await prisma.projectDrive.findUnique({
    where: { projectId },
    select: { id: true, status: true },
  });
  if (!drive || drive.status !== ProjectDriveStatus.ACTIVE) return null;
  const folders = (
    await prisma.driveFolder.findMany({
      where: { projectId, projectDriveId: drive.id },
      select: { id: true, key: true },
    })
  ).filter((f) => isShareableFolderKey(f.key));
  const folderIds = folders.map((f) => f.id);
  const [granted, rows] = await Promise.all([
    prisma.driveFolderGrant.count({ where: { folderId: { in: folderIds }, status: "OK" } }),
    prisma.driveFolderGrant.findMany({
      where: { folderId: { in: folderIds }, status: { not: "OK" } },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        email: true,
        status: true,
        lastError: true,
        permissionId: true,
        folder: { select: { key: true, department: { select: { name: true } } } },
        user: {
          select: {
            name: true,
            cloudConnections: { where: { provider: "GOOGLE_DRIVE" }, select: { accountEmail: true } },
          },
        },
      },
    }),
  ]);
  return {
    folders: folders.length,
    granted,
    unsynced: rows.map((r) => ({
      id: r.id,
      name: auditMemberName(r.user.name),
      email: r.email,
      folder: folderLabel(r.folder),
      // Снятие ждёт строка с выдачей у Google, которая уже не нужна (или неудачное снятие).
      action: r.status === "PENDING_REMOVE" || (r.status === "FAILED" && r.permissionId) ? "remove" : "add",
      reason: pendingReason(r),
      notGoogleEmail: !isKnownGoogleEmail(
        r.email,
        r.user.cloudConnections.map((c) => c.accountEmail),
      ),
    })),
  };
}

/** Сообщение после «Синхронизировать» / «Повторить». */
export function driveSyncResultText(result: DriveSyncResult): { ok: boolean; text: string } {
  if (result.status === "skipped") {
    return { ok: true, text: "Папок на диске проекта ещё нет — доступы выдаются после первой выгрузки" };
  }
  if (result.status === "reconnect") return { ok: false, text: RECONNECT_TEXT };
  const parts = [
    result.added ? `выдано ${result.added}` : null,
    result.regranted ? `перевыдано ${result.regranted}` : null,
    result.removed ? `снято ${result.removed}` : null,
  ].filter(Boolean);
  if (result.status === "partial") {
    return {
      ok: false,
      text: `Не синхронизировано: ${result.pending}${parts.length ? ` (${parts.join(", ")})` : ""} — см. список ниже`,
    };
  }
  return { ok: true, text: parts.length ? `Доступы синхронизированы: ${parts.join(", ")}` : "Доступы в порядке — изменений нет" };
}

