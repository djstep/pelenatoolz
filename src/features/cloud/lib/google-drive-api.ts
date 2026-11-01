import { randomUUID } from "node:crypto";
import { googleEndpoints } from "@/features/cloud/lib/endpoints";
import { CloudApiError, CloudReconnectRequiredError } from "@/features/cloud/lib/errors";

/**
 * Запись на Google Диск (права `drive.file`): папки, файлы, Google Таблица из Excel, доступы.
 * Только сервер: первым аргументом — токен доступа владельца диска.
 * Адреса — только из `googleEndpoints()` (вне production их подменяет заглушка).
 */

const PROVIDER = "GOOGLE_DRIVE" as const;

export const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type GoogleSheetReplaceMode = "update" | "recreate";

/**
 * Как заменять уже выгруженную Google Таблицу (решение владельца — дополнение 3 в WAVE_3_DRIVE_NOTES.md).
 * "update" — новый xlsx в тот же файл (`files.update`): ссылка у группы та же, прошлое — в истории версий.
 * "recreate" — запасной путь, если Google не примет xlsx в существующую таблицу: новый файл,
 * старый — в корзину, ссылка новая. Переключать только здесь.
 */
export const GOOGLE_SHEET_REPLACE_MODE: GoogleSheetReplaceMode = "update";

const FILE_FIELDS = "id,name,mimeType,webViewLink,trashed,parents";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  webUrl: string | null;
  trashed: boolean;
  parents: string[];
};

export type DriveUploadResult = { id: string; webUrl: string | null; mimeType: string };

export type DrivePermissionRole = "commenter" | "reader" | "writer";

type DriveFileJson = {
  id?: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  trashed?: boolean;
  parents?: string[];
};

// ---------- запросы и ошибки ----------

const RECONNECT_REASONS = new Set([
  "insufficientPermissions",
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
  "insufficientScopes",
]);
const RATE_LIMIT_REASONS = new Set([
  "sharingRateLimitExceeded",
  "userRateLimitExceeded",
  "rateLimitExceeded",
]);
const RATE_LIMIT_MESSAGE = "Google ограничил частоту запросов — повторите позже";

type GoogleErrorJson = {
  error?:
    | {
        status?: string;
        errors?: Array<{ reason?: string }>;
        details?: Array<{ reason?: string }>;
      }
    | string;
};

/** Коды причин из ответа Google: `errors[].reason`, `details[].reason`, `status` — по порядку. */
async function googleReasons(res: Response): Promise<string[]> {
  let body: GoogleErrorJson;
  try {
    body = (await res.json()) as GoogleErrorJson;
  } catch {
    return [];
  }
  const err = body?.error;
  if (!err) return [];
  if (typeof err === "string") return [err];
  const out: string[] = [];
  for (const e of err.errors ?? []) if (e?.reason) out.push(e.reason);
  for (const d of err.details ?? []) if (d?.reason) out.push(d.reason);
  if (err.status) out.push(err.status);
  return out;
}

/** Ответ Google с ошибкой → наша ошибка. Тело ответа в текст не попадает (там бывают почты). */
async function googleError(res: Response): Promise<Error> {
  const reasons = await googleReasons(res);
  const reason = reasons[0] ?? null;
  const status = res.status;

  if (status === 401) return new CloudReconnectRequiredError(PROVIDER, `http 401 ${reason ?? ""}`.trim());
  // Старые подключения с `drive.readonly`: писать токену нельзя — только переподключение.
  if (status === 403 && reasons.some((r) => RECONNECT_REASONS.has(r))) {
    return new CloudReconnectRequiredError(PROVIDER, `http 403 ${reason ?? ""}`.trim());
  }
  if (status === 429 || (status === 403 && reasons.some((r) => RATE_LIMIT_REASONS.has(r)))) {
    const rate = reasons.find((r) => RATE_LIMIT_REASONS.has(r)) ?? reason ?? "rateLimitExceeded";
    return new CloudApiError(PROVIDER, status, RATE_LIMIT_MESSAGE, rate);
  }
  if (status === 404) {
    return new CloudApiError(PROVIDER, 404, "Файл или папка не найдены на Google Диске", "notFound");
  }
  if (reasons.includes("storageQuotaExceeded")) {
    return new CloudApiError(PROVIDER, status, "На Google Диске нет места", reason);
  }
  if (status === 403) {
    return new CloudApiError(PROVIDER, 403, "Google Диск отказал в доступе к файлу", reason);
  }
  if (status === 400 && reasons.includes("invalidSharingRequest")) {
    return new CloudApiError(PROVIDER, 400, "Google не может выдать доступ на эту почту", reason);
  }
  if (status >= 500) {
    return new CloudApiError(PROVIDER, status, "Google Диск временно недоступен — попробуйте позже", reason);
  }
  return new CloudApiError(PROVIDER, status, `Google Диск отклонил запрос (код ${status})`, reason);
}

function networkError() {
  return new CloudApiError(PROVIDER, 0, "Google Диск недоступен — попробуйте позже", "network");
}

/** Запрос с токеном; ответ не 2xx — ошибка. `allow404` — вернуть null вместо «не найдено». */
async function googleSend(
  accessToken: string,
  url: string,
  init: RequestInit,
  allow404: boolean,
): Promise<Response | null> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw networkError();
  }
  if (res.ok) return res;
  if (allow404 && res.status === 404) return null;
  throw await googleError(res);
}

async function googleFetch(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  return (await googleSend(accessToken, url, init, false)) as Response;
}

function googleFetchOrNull(accessToken: string, url: string, init: RequestInit = {}) {
  return googleSend(accessToken, url, init, true);
}

async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new CloudApiError(PROVIDER, res.status, "Google Диск вернул непонятный ответ — попробуйте позже", "badResponse");
  }
}

function toDriveFile(json: DriveFileJson): DriveFile {
  if (!json.id) {
    throw new CloudApiError(PROVIDER, 200, "Google Диск вернул непонятный ответ — попробуйте позже", "badResponse");
  }
  return {
    id: json.id,
    name: json.name ?? "",
    mimeType: json.mimeType ?? "",
    webUrl: json.webViewLink ?? null,
    trashed: json.trashed === true,
    parents: json.parents ?? [],
  };
}

const fileUrl = (base: string, fileId: string) => `${base}/files/${encodeURIComponent(fileId)}`;

/** Тело `multipart/related`: часть 1 — метаданные JSON, часть 2 — содержимое файла. */
function multipartBody(metadata: Record<string, unknown>, content: Buffer, contentType: string) {
  const boundary = `pelena-${randomUUID()}`;
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = new Uint8Array(Buffer.concat([Buffer.from(head, "utf8"), content, Buffer.from(tail, "utf8")]));
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

// ---------- папки и файлы ----------

export async function createDriveFolder(
  accessToken: string,
  input: { name: string; parentId?: string | null },
): Promise<{ id: string; webUrl: string | null }> {
  const { driveApi } = googleEndpoints();
  const metadata: Record<string, unknown> = { name: input.name, mimeType: GOOGLE_FOLDER_MIME };
  if (input.parentId) metadata.parents = [input.parentId];
  const res = await googleFetch(accessToken, `${driveApi}/files?fields=id,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(metadata),
  });
  const file = toDriveFile(await readJson<DriveFileJson>(res));
  return { id: file.id, webUrl: file.webUrl };
}

/** Файл или папка; null — нет такого (или нет доступа у `drive.file`). Корзину решает вызывающий по `trashed`. */
export async function getDriveFile(accessToken: string, fileId: string): Promise<DriveFile | null> {
  const { driveApi } = googleEndpoints();
  const res = await googleFetchOrNull(accessToken, `${fileUrl(driveApi, fileId)}?fields=${FILE_FIELDS}`);
  if (!res) return null;
  return toDriveFile(await readJson<DriveFileJson>(res));
}

/** Новый файл в папке. `convertToGoogleSheet` — Google сам превращает xlsx в Google Таблицу. */
export async function uploadDriveFile(
  accessToken: string,
  input: {
    name: string;
    parentId: string;
    content: Buffer;
    sourceMimeType: string;
    convertToGoogleSheet?: boolean;
  },
): Promise<DriveUploadResult> {
  const { driveUpload } = googleEndpoints();
  const metadata: Record<string, unknown> = { name: input.name, parents: [input.parentId] };
  if (input.convertToGoogleSheet) metadata.mimeType = GOOGLE_SHEET_MIME;
  const { body, contentType } = multipartBody(metadata, input.content, input.sourceMimeType);
  const res = await googleFetch(
    accessToken,
    `${driveUpload}/files?uploadType=multipart&fields=id,mimeType,webViewLink`,
    { method: "POST", headers: { "Content-Type": contentType }, body },
  );
  const file = toDriveFile(await readJson<DriveFileJson>(res));
  return { id: file.id, webUrl: file.webUrl, mimeType: file.mimeType };
}

/**
 * Новое содержимое того же файла (`files.update` с загрузкой): id и ссылка не меняются.
 * `name` — переименование той же операцией.
 */
export async function replaceDriveFileContent(
  accessToken: string,
  fileId: string,
  input: { content: Buffer; sourceMimeType: string; name?: string },
): Promise<DriveUploadResult> {
  const { driveUpload } = googleEndpoints();
  const metadata: Record<string, unknown> = {};
  if (input.name) metadata.name = input.name;
  const { body, contentType } = multipartBody(metadata, input.content, input.sourceMimeType);
  const res = await googleFetch(
    accessToken,
    `${fileUrl(driveUpload, fileId)}?uploadType=multipart&fields=id,mimeType,webViewLink`,
    { method: "PATCH", headers: { "Content-Type": contentType }, body },
  );
  const file = toDriveFile(await readJson<DriveFileJson>(res));
  return { id: file.id, webUrl: file.webUrl, mimeType: file.mimeType };
}

async function patchDriveFile(accessToken: string, fileId: string, patch: Record<string, unknown>) {
  const { driveApi } = googleEndpoints();
  const res = await googleFetch(accessToken, `${fileUrl(driveApi, fileId)}?fields=${FILE_FIELDS}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(patch),
  });
  return toDriveFile(await readJson<DriveFileJson>(res));
}

export async function renameDriveFile(accessToken: string, fileId: string, name: string): Promise<DriveFile> {
  return patchDriveFile(accessToken, fileId, { name });
}

/** В корзину (не насовсем): хранитель может вернуть файл сам. */
export async function trashDriveFile(accessToken: string, fileId: string): Promise<void> {
  await patchDriveFile(accessToken, fileId, { trashed: true });
}

// ---------- доступы ----------

export async function createDrivePermission(
  accessToken: string,
  fileId: string,
  input: { email: string; role: DrivePermissionRole; sendNotificationEmail: boolean },
): Promise<{ permissionId: string }> {
  const { driveApi } = googleEndpoints();
  const url =
    `${fileUrl(driveApi, fileId)}/permissions` +
    `?sendNotificationEmail=${input.sendNotificationEmail ? "true" : "false"}&fields=id`;
  const res = await googleFetch(accessToken, url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ type: "user", role: input.role, emailAddress: input.email }),
  });
  const json = await readJson<{ id?: string }>(res);
  if (!json.id) {
    throw new CloudApiError(PROVIDER, 200, "Google Диск вернул непонятный ответ — попробуйте позже", "badResponse");
  }
  return { permissionId: json.id };
}

/** Снять доступ. 404 — уже снят (руками или вместе с файлом), не ошибка: `alreadyGone: true`. */
export async function deleteDrivePermission(
  accessToken: string,
  fileId: string,
  permissionId: string,
): Promise<{ alreadyGone: boolean }> {
  const { driveApi } = googleEndpoints();
  const res = await googleFetchOrNull(
    accessToken,
    `${fileUrl(driveApi, fileId)}/permissions/${encodeURIComponent(permissionId)}`,
    { method: "DELETE" },
  );
  return { alreadyGone: res === null };
}

// ---------- Google Таблица из Excel ----------

export type PutGoogleSheetResult = {
  id: string;
  webUrl: string | null;
  /** created — файла не было; replaced — тот же файл, новое содержимое; recreated — новый файл (старый удалён руками или заменён). */
  outcome: "created" | "replaced" | "recreated";
};

/**
 * Один файл на вызывной в папке: нет файла (или его удалили / убрали в корзину) — новый;
 * есть — заменить по `GOOGLE_SHEET_REPLACE_MODE`. `mode` — только для тестов.
 */
export async function putGoogleSheetFromXlsx(
  accessToken: string,
  input: { existingFileId?: string | null; name: string; parentId: string; content: Buffer },
  mode: GoogleSheetReplaceMode = GOOGLE_SHEET_REPLACE_MODE,
): Promise<PutGoogleSheetResult> {
  const upload = () =>
    uploadDriveFile(accessToken, {
      name: input.name,
      parentId: input.parentId,
      content: input.content,
      sourceMimeType: XLSX_MIME,
      convertToGoogleSheet: true,
    });

  if (!input.existingFileId) {
    const created = await upload();
    return { id: created.id, webUrl: created.webUrl, outcome: "created" };
  }

  const existing = await getDriveFile(accessToken, input.existingFileId);
  if (!existing || existing.trashed) {
    const created = await upload();
    return { id: created.id, webUrl: created.webUrl, outcome: "recreated" };
  }

  if (mode === "update") {
    const replaced = await replaceDriveFileContent(accessToken, existing.id, {
      content: input.content,
      sourceMimeType: XLSX_MIME,
      name: input.name,
    });
    return { id: replaced.id, webUrl: replaced.webUrl ?? existing.webUrl, outcome: "replaced" };
  }

  const created = await upload();
  try {
    await trashDriveFile(accessToken, existing.id);
  } catch {
    // Новый файл уже есть, его id нужен вызывающему; старый останется рядом — не повод падать.
  }
  return { id: created.id, webUrl: created.webUrl, outcome: "recreated" };
}
