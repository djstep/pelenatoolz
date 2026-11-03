import "server-only";

import {
  MembershipStatus,
  ProjectDriveStatus,
  type CloudProvider,
  type DriveExportFormat,
} from "@prisma/client";
import {
  getCloudConnection,
  getValidAccessToken,
  markCloudConnectionNeedsReconnect,
} from "@/features/cloud/lib/cloud-service";
import { isShareableFolderKey } from "@/features/cloud/lib/drive-access-rules";
import {
  DRIVE_FOLDER_KEYS,
  type DrivePutOutcome,
} from "@/features/cloud/lib/drive-export-rules";
import {
  putCallSheetInGoogleFolder,
  putCallSheetToGoogle,
  putCallSheetToYandex,
  type DriveFolderStore,
  type DrivePutResult,
  type StoredDriveFolder,
} from "@/features/cloud/lib/drive-put";
import { isCloudApiError, isCloudReconnectRequiredError } from "@/features/cloud/lib/errors";
import {
  ensureProjectFolderChain,
  ProjectFolderDepartmentGoneError,
  scheduleProjectFolderAccessAfterExport,
  type ProjectFolderTarget,
} from "@/features/cloud/lib/project-drive-folders";
import {
  projectDrivePlaceLabel,
  projectDriveUnavailable,
  type ProjectDriveUnavailable,
} from "@/features/cloud/lib/project-drive-export-rules";
import { keeperStillValid } from "@/features/cloud/lib/project-drive-rules";
import {
  getProjectDriveAccessToken,
  markProjectDriveNeedsReconnect,
} from "@/features/cloud/lib/project-drive-service";
import { connectionReconnectReason, reconnectReasonText } from "@/features/cloud/lib/scopes";
import { cloudProviderLabels } from "@/features/cloud/lib/types";
import { isProducerRole } from "@/features/roles/role-rules";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

/** «Уже на диске» в окне выгрузки. Почт нет; ссылка — только своему (личный диск). */
export type DriveExportView = {
  provider: CloudProvider;
  webUrl: string | null;
  uploadedByName: string | null;
  /** ISO-время выгрузки. */
  uploadedAt: string;
  version: number | null;
  statusLabel: string;
};

const exportViewSelect = {
  id: true,
  provider: true,
  webUrl: true,
  version: true,
  statusLabel: true,
  uploadedAt: true,
  uploadedBy: { select: { name: true, email: true } },
} as const;

function toView(row: {
  provider: CloudProvider;
  webUrl: string | null;
  version: number | null;
  statusLabel: string;
  uploadedAt: Date;
  uploadedBy: { name: string | null; email: string } | null;
}): DriveExportView {
  return {
    provider: row.provider,
    webUrl: row.webUrl,
    uploadedByName: row.uploadedBy ? row.uploadedBy.name || row.uploadedBy.email : null,
    uploadedAt: row.uploadedAt.toISOString(),
    version: row.version,
    statusLabel: row.statusLabel,
  };
}

/** Выгрузки вызывного дня на личные диски этого человека (по одной на провайдера). Только чтение. */
export async function listPersonalCallSheetExports(
  projectId: string,
  dayId: string,
  userId: string,
): Promise<DriveExportView[]> {
  const rows = await prisma.driveExport.findMany({
    where: {
      projectId,
      docType: "CALL_SHEET",
      docId: dayId,
      folder: { projectId, key: DRIVE_FOLDER_KEYS.callSheets, cloudConnection: { userId } },
    },
    orderBy: { provider: "asc" },
    select: exportViewSelect,
  });
  return rows.map(toView);
}

const FORMAT: Record<CloudProvider, DriveExportFormat> = {
  GOOGLE_DRIVE: "GOOGLE_SHEET",
  YANDEX_DISK: "XLSX",
};

const SLOW_OR_FAILED = "Не удалось выгрузить на диск — попробуйте ещё раз";
const TOO_SLOW = "Диск отвечает слишком долго — выгрузка не завершена, попробуйте ещё раз";
const BUSY = "На этот диск уже идёт выгрузка — попробуйте через минуту";

/** Предел транзакции выгрузки. У Prisma по умолчанию 5 с — для загрузки в Google мало. */
const TX_TIMEOUT_MS = 60_000;
/**
 * Сколько ждать блокировку и Google / Яндекс от начала транзакции — с запасом до её предела:
 * успеть сохранить созданные папки и закрыть транзакцию самим, а не по таймауту Prisma.
 */
const DEADLINE_MS = 50_000;

/** Вне production предел можно уменьшить (`DRIVE_EXPORT_DEADLINE_MS`, e2e с медленной заглушкой). */
export function driveExportDeadlineMs(): number {
  if (process.env.NODE_ENV !== "production") {
    const raw = Number(process.env.DRIVE_EXPORT_DEADLINE_MS);
    if (Number.isInteger(raw) && raw >= 1_000 && raw <= DEADLINE_MS) return raw;
  }
  return DEADLINE_MS;
}

class DriveDeadlineError extends Error {
  constructor() {
    super(TOO_SLOW);
    this.name = "DriveDeadlineError";
  }
}

/**
 * Ждать не дольше `deadlineAt`. Запрос к диску не прерывается (fetch без отмены), но его
 * результат уже никуда не пишется; его ошибка не всплывает необработанной.
 */
function beforeDeadline<T>(work: Promise<T>, deadlineAt: number): Promise<T> {
  work.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DriveDeadlineError()), Math.max(0, deadlineAt - Date.now()));
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Postgres `lock_not_available` (55P03): не дождались блокировки за `lock_timeout`. */
function isLockTimeout(e: unknown) {
  const meta = (e as { meta?: { code?: unknown } } | null)?.meta;
  return meta?.code === "55P03" || (e instanceof Error && /lock timeout/i.test(e.message));
}

/** Prisma закрыла транзакцию по таймауту (P2028). */
function isTransactionTimeout(e: unknown) {
  return (e as { code?: unknown } | null)?.code === "P2028";
}

export type PersonalDriveExportResult =
  | { ok: true; view: DriveExportView; outcome: DrivePutOutcome }
  | { error: string; reconnect?: boolean };

/**
 * Вызывной на личный диск человека (`userId` — из сессии; подключение — только своё).
 * Одна выгрузка за раз на подключение: строка `CloudConnection` берётся под блокировку
 * (`SELECT … FOR UPDATE`) на всё время — от поиска прежнего файла до записи `DriveExport`.
 * Двойной клик или две вкладки: второй запрос ждёт, видит запись первого и заменяет тот же файл.
 * Ошибка Google / Яндекса не откатывает уже созданные папки (иначе следующая выгрузка сделала бы
 * вторую): транзакция завершается, ошибка возвращается текстом.
 * Время: транзакция — до 60 с; блокировку и диск ждём до `driveExportDeadlineMs()` от её начала,
 * дальше — «диск отвечает слишком долго», запись `DriveExport` не делается.
 */
export async function putCallSheetOnPersonalDrive(input: {
  userId: string;
  projectId: string;
  dayId: string;
  dayNumber: number;
  provider: CloudProvider;
  projectName: string;
  fileName: string;
  content: Buffer;
  version: number | null;
  statusLabel: string;
}): Promise<PersonalDriveExportResult> {
  const { userId, projectId, dayId, provider } = input;
  const label = cloudProviderLabels[provider];
  const notConnected = `${label} не подключён — подключите его в «Профиле»`;

  const conn = await getCloudConnection(userId, provider);
  if (!conn) return { error: notConnected };
  const reason = connectionReconnectReason(conn);
  if (reason) return { error: reconnectReasonText(provider, reason), reconnect: true };

  // Токен — до блокировки: обновление токена пишет в ту же строку подключения.
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(conn.id, userId);
  } catch (e) {
    if (isCloudReconnectRequiredError(e)) return { error: e.message, reconnect: true };
    if (isCloudApiError(e)) return { error: e.message };
    console.error("[drive export] токен", e);
    return { error: SLOW_OR_FAILED };
  }

  let result:
    | { saved: Parameters<typeof toView>[0]; outcome: DrivePutOutcome }
    | { failure: Error }
    | { missing: true };
  const deadlineAt = Date.now() + driveExportDeadlineMs();
  try {
    result = await prisma.$transaction(
      async (tx) => {
        // Вторая выгрузка ждёт первую не дольше своего предела, а не до таймаута транзакции.
        const lockWaitMs = Math.max(1_000, Math.floor(deadlineAt - Date.now()));
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${lockWaitMs}`);
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "CloudConnection" WHERE "id" = ${conn.id} FOR UPDATE`;
        if (locked.length === 0) return { missing: true as const };

        const rows = await tx.driveFolder.findMany({
          where: { cloudConnectionId: conn.id, projectId },
          select: { key: true, externalId: true, webUrl: true },
        });
        const known = new Map<string, StoredDriveFolder>(
          rows.map((r) => [r.key, { externalId: r.externalId, webUrl: r.webUrl }]),
        );
        // После предела транзакция закрывается — запоздавший ответ диска папки уже не пишет.
        let closed = false;
        const folders: DriveFolderStore = {
          get: (key) => known.get(key) ?? null,
          save: async (key, folder) => {
            if (closed) return;
            await tx.driveFolder.upsert({
              where: {
                cloudConnectionId_projectId_key: { cloudConnectionId: conn.id, projectId, key },
              },
              create: { projectId, cloudConnectionId: conn.id, key, ...folder },
              update: folder,
            });
            known.set(key, folder);
          },
        };

        const existing = await tx.driveExport.findFirst({
          where: {
            projectId,
            docType: "CALL_SHEET",
            docId: dayId,
            folder: { cloudConnectionId: conn.id, projectId, key: DRIVE_FOLDER_KEYS.callSheets },
          },
          select: { externalId: true },
        });

        let put: DrivePutResult;
        try {
          put = await beforeDeadline(
            provider === "GOOGLE_DRIVE"
              ? putCallSheetToGoogle(accessToken, {
                  folders,
                  projectName: input.projectName,
                  existingFileId: existing?.externalId ?? null,
                  fileName: input.fileName,
                  content: input.content,
                })
              : putCallSheetToYandex(accessToken, {
                  folders,
                  projectId,
                  projectName: input.projectName,
                  existingPath: existing?.externalId ?? null,
                  fileName: input.fileName,
                  content: input.content,
                }),
            deadlineAt,
          );
        } catch (e) {
          if (e instanceof DriveDeadlineError) {
            closed = true;
            return { failure: e };
          }
          if (isCloudReconnectRequiredError(e) || isCloudApiError(e)) return { failure: e };
          throw e;
        }

        const folder = await tx.driveFolder.findUniqueOrThrow({
          where: {
            cloudConnectionId_projectId_key: {
              cloudConnectionId: conn.id,
              projectId,
              key: DRIVE_FOLDER_KEYS.callSheets,
            },
          },
          select: { id: true },
        });
        const data = {
          provider,
          format: FORMAT[provider],
          externalId: put.externalId,
          webUrl: put.webUrl,
          version: input.version,
          statusLabel: input.statusLabel,
          uploadedById: userId,
          uploadedAt: new Date(),
        };
        const versionText = input.version ? `версия ${input.version}, ` : "";
        const saved = await auditMutation(
          { user: { id: userId } },
          () =>
            tx.driveExport.upsert({
              where: {
                folderId_docType_docId: { folderId: folder.id, docType: "CALL_SHEET", docId: dayId },
              },
              create: { projectId, docType: "CALL_SHEET", docId: dayId, folderId: folder.id, ...data },
              update: data,
              select: exportViewSelect,
            }),
          undefined,
          {
            projectId,
            entityType: AuditEntityType.driveExport,
            action: existing ? "UPDATE" : "CREATE",
            entityId: (_input, row) => row.id,
            summary: `Вызывной дня ${input.dayNumber} (${versionText}${input.statusLabel}) выгружен на личный ${label}`,
            // Без ссылок и почт: личный диск — не для журнала проекта.
            changes: {
              provider,
              destination: "personal",
              dayId,
              version: input.version,
              status: input.statusLabel,
              outcome: put.outcome,
            },
          },
          { db: tx },
        );
        return { saved, outcome: put.outcome };
      },
      // Внутри — запросы к Google / Яндексу; второй запрос ждёт первый на блокировке.
      { maxWait: 10_000, timeout: TX_TIMEOUT_MS },
    );
  } catch (e) {
    if (isLockTimeout(e)) return { error: BUSY };
    if (isTransactionTimeout(e)) return { error: TOO_SLOW };
    console.error("[drive export] транзакция", e);
    return { error: SLOW_OR_FAILED };
  }

  if ("missing" in result) return { error: notConnected };
  if ("failure" in result) {
    const e = result.failure;
    if (isCloudReconnectRequiredError(e)) {
      await markCloudConnectionNeedsReconnect(conn);
      return { error: e.message, reconnect: true };
    }
    return { error: e.message };
  }
  return { ok: true, view: toView(result.saved), outcome: result.outcome };
}

// ---------- диск проекта (шаг 6) ----------

/** «Уже на диске» у назначений диска проекта: ключ папки (`common` / `dept:<id>`) и выгрузка. */
export type ProjectDriveExportView = { key: string; view: DriveExportView };

/** Выгрузки вызывного дня в «Общую» и папки цехов действующего диска проекта. Только чтение. */
export async function listProjectCallSheetExports(
  projectId: string,
  dayId: string,
): Promise<ProjectDriveExportView[]> {
  const rows = await prisma.driveExport.findMany({
    where: {
      projectId,
      docType: "CALL_SHEET",
      docId: dayId,
      folder: { projectId, projectDrive: { projectId, status: ProjectDriveStatus.ACTIVE } },
    },
    select: { ...exportViewSelect, folder: { select: { key: true } } },
  });
  return rows
    .filter((r) => isShareableFolderKey(r.folder.key))
    .map((r) => ({ key: r.folder.key, view: toView(r) }));
}

/** Годится ли диск проекта для выгрузки сейчас (без блокировки — для окна и первой проверки). */
export async function getProjectDriveExportAvailability(
  projectId: string,
): Promise<ProjectDriveUnavailable | null> {
  const drive = await prisma.projectDrive.findUnique({
    where: { projectId },
    select: {
      status: true,
      accessToken: true,
      needsReconnectAt: true,
      keeperMembership: {
        select: { projectId: true, status: true, role: { select: { isSystem: true, name: true } } },
      },
    },
  });
  const keeper = drive?.keeperMembership;
  return projectDriveUnavailable(
    drive && {
      status: drive.status,
      hasToken: drive.accessToken != null,
      needsReconnect: drive.needsReconnectAt != null,
      keeperActiveProducer: keeperStillValid(
        keeper && keeper.projectId === projectId
          ? { active: keeper.status === MembershipStatus.ACTIVE, isProducer: isProducerRole(keeper.role) }
          : null,
      ),
    },
  );
}

export type ProjectDriveExportResult =
  | { ok: true; view: DriveExportView; outcome: DrivePutOutcome; placeLabel: string }
  | { error: string }
  | { unavailable: ProjectDriveUnavailable };

type EnsuredFolder = Awaited<ReturnType<typeof ensureProjectFolderChain>>;

/**
 * Вызывной на диск проекта — в «Общую» или папку цеха (только Google, токен хранителя). Права
 * человека и принадлежность дня / цеха проекту проверяет вызывающий (`drive-actions.ts`).
 * Одна выгрузка за раз на диск проекта: строка `ProjectDrive` под блокировкой (`SELECT … FOR UPDATE`)
 * от создания папок (`ensureProjectFolderChain`) до записи `DriveExport`. Две первые выгрузки сразу:
 * вторая ждёт, видит папку и запись первой — одна «Общая», один файл. Под блокировкой ещё раз:
 * диск тот же и активен, без «нужно переподключить», хранитель — активный продюсер.
 * Время и сообщения — как у личного диска. Доступы новой папке выдаются после ответа.
 */
export async function putCallSheetOnProjectDrive(input: {
  userId: string;
  projectId: string;
  dayId: string;
  dayNumber: number;
  /** Вызывной — только в «Общую» или папку цеха вызывных. */
  target: Extract<ProjectFolderTarget, { kind: "common" | "department" }>;
  projectName: string;
  fileName: string;
  content: Buffer;
  version: number | null;
  statusLabel: string;
}): Promise<ProjectDriveExportResult> {
  const { userId, projectId, dayId, target } = input;

  const unavailable = await getProjectDriveExportAvailability(projectId);
  if (unavailable) return { unavailable };
  const drive = await prisma.projectDrive.findUnique({
    where: { projectId },
    select: { id: true, connectedAt: true },
  });
  if (!drive) return { unavailable: "not_connected" };

  // Токен — до блокировки: обновление токена пишет в ту же строку диска проекта.
  let accessToken: string;
  try {
    accessToken = await getProjectDriveAccessToken(projectId, userId);
  } catch (e) {
    // Отозван при обновлении — диск уже помечен «нужно переподключить».
    if (isCloudReconnectRequiredError(e)) return { unavailable: "reconnect" };
    if (isCloudApiError(e)) return { error: e.message };
    console.error("[drive export] токен диска проекта", e);
    return { error: SLOW_OR_FAILED };
  }

  let result:
    | { saved: Parameters<typeof toView>[0]; outcome: DrivePutOutcome; placeLabel: string }
    | { failure: Error }
    | { unavailable: ProjectDriveUnavailable };
  const deadlineAt = Date.now() + driveExportDeadlineMs();
  try {
    result = await prisma.$transaction(
      async (tx) => {
        // Вторая выгрузка ждёт первую не дольше своего предела, а не до таймаута транзакции.
        const lockWaitMs = Math.max(1_000, Math.floor(deadlineAt - Date.now()));
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${lockWaitMs}`);
        const locked = await tx.$queryRaw<
          {
            id: string;
            status: string;
            needsReconnectAt: Date | null;
            connectedAt: Date;
            keeperMembershipId: string | null;
          }[]
        >`
          SELECT "id", "status", "needsReconnectAt", "connectedAt", "keeperMembershipId"
          FROM "ProjectDrive" WHERE "projectId" = ${projectId} FOR UPDATE`;
        const row = locked[0];
        // Пока брали токен, диск отключили или заменили (`connectedAt` меняется при каждом подключении).
        if (
          !row ||
          row.id !== drive.id ||
          row.status !== ProjectDriveStatus.ACTIVE ||
          row.connectedAt.getTime() !== drive.connectedAt.getTime()
        ) {
          return { unavailable: "not_connected" as const };
        }
        if (row.needsReconnectAt) return { unavailable: "reconnect" as const };
        const keeper = row.keeperMembershipId
          ? await tx.projectMembership.findFirst({
              where: { id: row.keeperMembershipId, projectId },
              select: { status: true, role: { select: { isSystem: true, name: true } } },
            })
          : null;
        const keeperValid = keeperStillValid(
          keeper && { active: keeper.status === MembershipStatus.ACTIVE, isProducer: isProducerRole(keeper.role) },
        );
        if (!keeperValid) return { unavailable: "not_connected" as const };

        // После предела транзакция закрывается — запоздавший ответ Google папки уже не пишет.
        let closed = false;
        let folder: EnsuredFolder;
        let existing: { externalId: string } | null;
        let put: DrivePutResult;
        try {
          folder = await beforeDeadline(
            ensureProjectFolderChain(tx, accessToken, {
              projectId,
              driveId: drive.id,
              projectName: input.projectName,
              target,
              canWrite: () => !closed,
            }),
            deadlineAt,
          );
          // Выдачи прежней (удалённой руками) папки умерли вместе с ней — выдаются заново после ответа.
          if (folder.outcome === "recreated") {
            await tx.driveFolderGrant.deleteMany({ where: { folderId: folder.folderId } });
          }
          existing = await tx.driveExport.findUnique({
            where: {
              folderId_docType_docId: { folderId: folder.folderId, docType: "CALL_SHEET", docId: dayId },
            },
            select: { externalId: true },
          });
          put = await beforeDeadline(
            putCallSheetInGoogleFolder(accessToken, {
              folderId: folder.externalId,
              folderRecreated: folder.outcome === "recreated",
              existingFileId: existing?.externalId ?? null,
              fileName: input.fileName,
              content: input.content,
            }),
            deadlineAt,
          );
        } catch (e) {
          if (e instanceof DriveDeadlineError) {
            closed = true;
            return { failure: e };
          }
          if (
            isCloudReconnectRequiredError(e) ||
            isCloudApiError(e) ||
            e instanceof ProjectFolderDepartmentGoneError
          ) {
            return { failure: e };
          }
          throw e;
        }

        const placeLabel = projectDrivePlaceLabel(target.kind, folder.departmentName);
        const data = {
          provider: "GOOGLE_DRIVE" as const,
          format: FORMAT.GOOGLE_DRIVE,
          externalId: put.externalId,
          webUrl: put.webUrl,
          version: input.version,
          statusLabel: input.statusLabel,
          uploadedById: userId,
          uploadedAt: new Date(),
        };
        const versionText = input.version ? `версия ${input.version}, ` : "";
        const saved = await auditMutation(
          { user: { id: userId } },
          () =>
            tx.driveExport.upsert({
              where: {
                folderId_docType_docId: { folderId: folder.folderId, docType: "CALL_SHEET", docId: dayId },
              },
              create: { projectId, docType: "CALL_SHEET", docId: dayId, folderId: folder.folderId, ...data },
              update: data,
              select: exportViewSelect,
            }),
          undefined,
          {
            projectId,
            entityType: AuditEntityType.driveExport,
            action: existing ? "UPDATE" : "CREATE",
            entityId: (_input, row) => row.id,
            summary: `Вызывной дня ${input.dayNumber} (${versionText}${input.statusLabel}) выгружен на диск проекта — ${placeLabel}`,
            // Без ссылок и почт.
            changes: {
              provider: "GOOGLE_DRIVE",
              destination: target.kind,
              ...(target.kind === "department"
                ? { departmentId: target.departmentId, departmentName: folder.departmentName }
                : {}),
              dayId,
              version: input.version,
              status: input.statusLabel,
              outcome: put.outcome,
            },
          },
          { db: tx },
        );
        return { saved, outcome: put.outcome, placeLabel };
      },
      // Внутри — запросы к Google; второй запрос ждёт первый на блокировке.
      { maxWait: 10_000, timeout: TX_TIMEOUT_MS },
    );
  } catch (e) {
    if (isLockTimeout(e)) return { error: BUSY };
    if (isTransactionTimeout(e)) return { error: TOO_SLOW };
    console.error("[drive export] транзакция диска проекта", e);
    return { error: SLOW_OR_FAILED };
  }

  if ("unavailable" in result) return { unavailable: result.unavailable };
  // После каждой выгрузки в папку — пересчёт её доступов после ответа, и когда файл не лёг: папка
  // могла создаться, а предел выйти до выдачи. Доступ отозван — пересчитывать нечем.
  if (!("failure" in result && isCloudReconnectRequiredError(result.failure))) {
    scheduleProjectFolderAccessAfterExport(projectId, drive.id, target, userId);
  }
  if ("failure" in result) {
    const e = result.failure;
    if (isCloudReconnectRequiredError(e)) {
      // Пометка — после транзакции: она пишет в строку диска, которую держала блокировка.
      await markProjectDriveNeedsReconnect({ id: drive.id, projectId }, userId);
      return { unavailable: "reconnect" };
    }
    return { error: e.message };
  }
  return { ok: true, view: toView(result.saved), outcome: result.outcome, placeLabel: result.placeLabel };
}
