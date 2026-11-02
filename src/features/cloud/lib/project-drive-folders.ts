import "server-only";

import { ProjectDriveStatus } from "@prisma/client";
import { after } from "next/server";
import {
  COMMON_FOLDER_NAME,
  departmentFolderKey,
  DEPARTMENTS_FOLDER_NAME,
  PROJECT_FOLDER_KEYS,
} from "@/features/cloud/lib/drive-access-rules";
import { syncProjectDriveAccess } from "@/features/cloud/lib/drive-access-sync";
import { CALL_SHEETS_FOLDER_NAME, googleProjectFolderName } from "@/features/cloud/lib/drive-export-rules";
import { ensureGoogleFolder, type DriveFolderStore, type StoredDriveFolder } from "@/features/cloud/lib/drive-put";
import { getDriveFile, renameDriveFile } from "@/features/cloud/lib/google-drive-api";
import { withProjectDriveAccessToken } from "@/features/cloud/lib/project-drive-service";
import { prisma } from "@/shared/db/prisma";

/**
 * Папки на диске проекта (Google): `PELENA · <Проект> / Вызывные / Общая` и
 * `PELENA · <Проект> / Вызывные / Цеха / <Цех>`. Создаются токеном хранителя при первой
 * выгрузке в папку (шаг 6 вызывает `ensureProjectDriveFolder`), id — в `DriveFolder`.
 */

export type ProjectFolderTarget = { kind: "common" } | { kind: "department"; departmentId: string };

export type EnsuredProjectFolder = {
  folderId: string;
  externalId: string;
  webUrl: string | null;
  /** created — папки не было; recreated — запомненную удалили на диске руками. */
  outcome: "existing" | "created" | "recreated";
};

/**
 * Обеспечить конечную папку: недостающую цепочку — создать, удалённую руками (404 / корзина / не
 * в своей родительской) — создать заново. После создания конечной папки сразу выдаются доступы
 * (у пересозданной прежние выдачи умерли вместе с ней — выдаются заново).
 * Права вызывающего и принадлежность цеха проекту проверяет вызывающий (`assertInProject`).
 * Доступ к диску отозван — `CloudReconnectRequiredError` (диск помечен «нужно переподключить»).
 */
export async function ensureProjectDriveFolder(
  projectId: string,
  target: ProjectFolderTarget,
  actorUserId: string,
): Promise<EnsuredProjectFolder> {
  const drive = await prisma.projectDrive.findUnique({
    where: { projectId },
    select: { id: true, status: true, project: { select: { name: true } } },
  });
  if (!drive || drive.status !== ProjectDriveStatus.ACTIVE) throw new Error("Диск проекта не подключён");

  let department: { id: string; name: string } | null = null;
  if (target.kind === "department") {
    department = await prisma.department.findFirst({
      where: { id: target.departmentId, projectId },
      select: { id: true, name: true },
    });
    if (!department) throw new Error("Цех не найден");
  }
  const leafKey = department ? departmentFolderKey(department.id) : PROJECT_FOLDER_KEYS.common;

  const rows = await prisma.driveFolder.findMany({
    where: { projectId, projectDriveId: drive.id },
    select: { id: true, key: true, externalId: true, webUrl: true },
  });
  const saved = new Map<string, StoredDriveFolder>(
    rows.map((r) => [r.key, { externalId: r.externalId, webUrl: r.webUrl }]),
  );
  const store: DriveFolderStore = {
    get: (key) => saved.get(key) ?? null,
    save: async (key, folder) => {
      const departmentId = key === leafKey && department ? department.id : null;
      await prisma.driveFolder.upsert({
        where: { projectDriveId_key: { projectDriveId: drive.id, key } },
        create: { projectId, projectDriveId: drive.id, key, departmentId, ...folder },
        update: { departmentId, ...folder },
      });
      saved.set(key, folder);
    },
  };

  const leaf = await withProjectDriveAccessToken(projectId, actorUserId, async (accessToken) => {
    const root = await ensureGoogleFolder(
      accessToken,
      store,
      PROJECT_FOLDER_KEYS.root,
      googleProjectFolderName(drive.project.name),
      null,
    );
    const callSheets = await ensureGoogleFolder(
      accessToken,
      store,
      PROJECT_FOLDER_KEYS.callSheets,
      CALL_SHEETS_FOLDER_NAME,
      root.id,
    );
    if (!department) {
      return ensureGoogleFolder(accessToken, store, leafKey, COMMON_FOLDER_NAME, callSheets.id);
    }
    const departments = await ensureGoogleFolder(
      accessToken,
      store,
      PROJECT_FOLDER_KEYS.departments,
      DEPARTMENTS_FOLDER_NAME,
      callSheets.id,
    );
    const folder = await ensureGoogleFolder(accessToken, store, leafKey, department.name, departments.id);
    // Цех переименовали, а переименование папки не прошло (Google был недоступен) — догоняем.
    if (folder.name !== department.name) await renameDriveFile(accessToken, folder.id, department.name);
    return folder;
  });

  const row = await prisma.driveFolder.findUniqueOrThrow({
    where: { projectDriveId_key: { projectDriveId: drive.id, key: leafKey } },
    select: { id: true, externalId: true, webUrl: true },
  });
  const existed = rows.some((r) => r.key === leafKey);
  const outcome = !existed ? "created" : leaf.recreated ? "recreated" : "existing";
  if (outcome !== "existing") {
    // Выдачи прежней папки умерли вместе с ней — строки убрать, выдать заново в новой.
    if (outcome === "recreated") await prisma.driveFolderGrant.deleteMany({ where: { folderId: row.id } });
    await syncProjectDriveAccess(projectId, {
      actorUserId,
      trigger: "folder_created",
      folderIds: [row.id],
    });
  }
  return { folderId: row.id, externalId: row.externalId, webUrl: row.webUrl, outcome };
}

/**
 * Цех переименовали — переименовать его папку на диске проекта (после ответа, `after()`).
 * Папки нет, диск не подключён или папку удалили руками — ничего (при выгрузке создастся с новым именем).
 */
export function scheduleDepartmentFolderRename(projectId: string, departmentId: string, actorUserId: string) {
  after(async () => {
    try {
      const drive = await prisma.projectDrive.findUnique({
        where: { projectId },
        select: { id: true, status: true, needsReconnectAt: true },
      });
      if (!drive || drive.status !== ProjectDriveStatus.ACTIVE || drive.needsReconnectAt) return;
      const [folder, department] = await Promise.all([
        prisma.driveFolder.findUnique({
          where: { projectDriveId_key: { projectDriveId: drive.id, key: departmentFolderKey(departmentId) } },
          select: { externalId: true },
        }),
        prisma.department.findFirst({ where: { id: departmentId, projectId }, select: { name: true } }),
      ]);
      if (!folder || !department) return;
      await withProjectDriveAccessToken(projectId, actorUserId, async (accessToken) => {
        const file = await getDriveFile(accessToken, folder.externalId);
        if (file && !file.trashed && file.name !== department.name) {
          await renameDriveFile(accessToken, folder.externalId, department.name);
        }
      });
    } catch (e) {
      console.error("[drive folder rename]", projectId, e instanceof Error ? e.message : e);
    }
  });
}
