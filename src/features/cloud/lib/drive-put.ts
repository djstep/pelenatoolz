import {
  createDriveFolder,
  getDriveFile,
  putGoogleSheetFromXlsx,
} from "@/features/cloud/lib/google-drive-api";
import {
  CALL_SHEETS_FOLDER_NAME,
  DRIVE_FOLDER_KEYS,
  googleProjectFolderName,
  yandexProjectFolderName,
  type DrivePutOutcome,
} from "@/features/cloud/lib/drive-export-rules";
import {
  ensureYandexFolder,
  getYandexResource,
  moveYandexResource,
  uploadYandexFile,
  yandexAppPath,
  yandexWebFolderUrl,
} from "@/features/cloud/lib/yandex-disk-api";

/**
 * Файл на личный диск: папки системы и один файл на документ в папке. Только сеть — что
 * запомнить, решает вызывающий: папки сохраняются через `folders.save` сразу после создания
 * (если дальше запрос упадёт, повторная выгрузка не создаст вторую папку).
 */

export type StoredDriveFolder = { externalId: string; webUrl: string | null };

export type DriveFolderStore = {
  get: (key: string) => StoredDriveFolder | null;
  save: (key: string, folder: StoredDriveFolder) => Promise<void>;
};

export type DrivePutResult = {
  externalId: string;
  webUrl: string | null;
  outcome: DrivePutOutcome;
};

export type GoogleFolder = { id: string; name: string; webUrl: string | null; recreated: boolean };

/**
 * Папка по ключу: запомненная жива (есть, не в корзине, лежит в `parentId`) — она; иначе новая.
 * `recreated` — запомненную удалили руками.
 */
export async function ensureGoogleFolder(
  accessToken: string,
  folders: DriveFolderStore,
  key: string,
  name: string,
  parentId: string | null,
): Promise<GoogleFolder> {
  const saved = folders.get(key);
  if (saved) {
    const file = await getDriveFile(accessToken, saved.externalId);
    if (file && !file.trashed && (!parentId || file.parents.includes(parentId))) {
      return { id: file.id, name: file.name, webUrl: file.webUrl ?? saved.webUrl, recreated: false };
    }
  }
  const created = await createDriveFolder(accessToken, { name, parentId });
  await folders.save(key, { externalId: created.id, webUrl: created.webUrl });
  return { id: created.id, name, webUrl: created.webUrl, recreated: saved !== null };
}

/**
 * Google: `PELENA · <Проект>/Вызывные`, файл — Google Таблица из xlsx. Есть файл — то же id,
 * новое содержимое и имя (`GOOGLE_SHEET_REPLACE_MODE`); папку пересоздали — файл новый.
 */
export async function putCallSheetToGoogle(
  accessToken: string,
  input: {
    folders: DriveFolderStore;
    projectName: string;
    existingFileId: string | null;
    fileName: string;
    content: Buffer;
  },
): Promise<DrivePutResult> {
  const root = await ensureGoogleFolder(
    accessToken,
    input.folders,
    DRIVE_FOLDER_KEYS.root,
    googleProjectFolderName(input.projectName),
    null,
  );
  const callSheets = await ensureGoogleFolder(
    accessToken,
    input.folders,
    DRIVE_FOLDER_KEYS.callSheets,
    CALL_SHEETS_FOLDER_NAME,
    root.id,
  );
  // Папку пересоздали — прежний файл остался в удалённой: кладём новый в новую.
  const folderLost = root.recreated || callSheets.recreated;
  const put = await putGoogleSheetFromXlsx(accessToken, {
    existingFileId: folderLost ? null : input.existingFileId,
    name: input.fileName,
    parentId: callSheets.id,
    content: input.content,
  });
  const outcome: DrivePutOutcome =
    input.existingFileId && (folderLost || put.outcome !== "replaced") ? "recreated" : put.outcome;
  return { externalId: put.id, webUrl: put.webUrl, outcome };
}

/**
 * Google, готовая папка (диск проекта: «Общая» / папка цеха — `ensureProjectFolderChain`): один файл
 * на вызывной. Есть файл — то же id, новое содержимое и имя; папку пересоздали — файл новый.
 */
export async function putCallSheetInGoogleFolder(
  accessToken: string,
  input: {
    folderId: string;
    folderRecreated: boolean;
    existingFileId: string | null;
    fileName: string;
    content: Buffer;
  },
): Promise<DrivePutResult> {
  const put = await putGoogleSheetFromXlsx(accessToken, {
    existingFileId: input.folderRecreated ? null : input.existingFileId,
    name: input.fileName,
    parentId: input.folderId,
    content: input.content,
  });
  const outcome: DrivePutOutcome =
    input.existingFileId && (input.folderRecreated || put.outcome !== "replaced") ? "recreated" : put.outcome;
  return { externalId: put.id, webUrl: put.webUrl, outcome };
}

/**
 * Яндекс: папка приложения `<Проект> · <id>/Вызывные`, файл `.xlsx`. Есть прежний файл — переименовать
 * в новое имя и записать поверх; нет — новый. Ссылка — на папку в веб-версии Диска (видна только
 * владельцу: публиковать файл по ссылке для всех нельзя, в вызывном телефоны).
 */
export async function putCallSheetToYandex(
  accessToken: string,
  input: {
    folders: DriveFolderStore;
    projectId: string;
    projectName: string;
    existingPath: string | null;
    fileName: string;
    content: Buffer;
  },
): Promise<DrivePutResult> {
  const rootPath =
    input.folders.get(DRIVE_FOLDER_KEYS.root)?.externalId ??
    yandexAppPath(yandexProjectFolderName(input.projectName, input.projectId));
  const savedFolder = input.folders.get(DRIVE_FOLDER_KEYS.callSheets);
  const folderPath = savedFolder?.externalId ?? `${rootPath}/${CALL_SHEETS_FOLDER_NAME}`;

  // Создаёт и недостающих родителей; удалённую руками папку — заново по тому же пути.
  await ensureYandexFolder(accessToken, folderPath);
  if (!input.folders.get(DRIVE_FOLDER_KEYS.root)) {
    await input.folders.save(DRIVE_FOLDER_KEYS.root, { externalId: rootPath, webUrl: null });
  }
  let webUrl = savedFolder?.webUrl ?? null;
  if (!savedFolder) {
    const folder = await getYandexResource(accessToken, folderPath);
    webUrl = yandexWebFolderUrl(folder?.path);
    await input.folders.save(DRIVE_FOLDER_KEYS.callSheets, { externalId: folderPath, webUrl });
  }

  const filePath = `${folderPath}/${input.fileName.replace(/[/\\]+/g, "-")}.xlsx`;
  let outcome: DrivePutOutcome = "created";
  if (input.existingPath) {
    const old = await getYandexResource(accessToken, input.existingPath);
    if (old?.type === "file") {
      if (input.existingPath !== filePath) {
        await moveYandexResource(accessToken, input.existingPath, filePath, { overwrite: true });
      }
      outcome = "replaced";
    } else {
      outcome = "recreated";
    }
  }
  await uploadYandexFile(accessToken, filePath, input.content, { overwrite: true });
  return { externalId: filePath, webUrl, outcome };
}
