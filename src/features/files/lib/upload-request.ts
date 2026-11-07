export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
export const UPLOAD_TOO_LARGE = "Максимум 512 МБ на файл";
export const UPLOAD_EMPTY = "Пустой файл";

/** Заголовки загрузки: тело запроса — сам файл, поэтому имя и назначение идут отдельно. */
export const UPLOAD_NAME_HEADER = "x-file-name";
export const UPLOAD_SCOPE_HEADER = "x-upload-scope";

export type UploadHead = {
  name: string;
  /** Тип от браузера; пусто — браузер его не знает. */
  type: string;
  /** Размер из `Content-Length`; настоящий считается при записи. */
  declaredBytes: number | null;
  /** Файл договора закрыт с момента загрузки: сбой привязки не оставит его общим. */
  contractsOnly: boolean;
};

export type UploadRefusal = { error: string; status: number };

/** Всё, что можно проверить до чтения тела. */
export function readUploadHead(headers: Headers): UploadHead | UploadRefusal {
  const contentType = headers.get("content-type")?.trim() ?? "";
  // Вкладка, открытая до обновления сайта: её тело записалось бы как файл вместе с разметкой формы.
  if (/^multipart\//i.test(contentType)) {
    return { error: "Сайт обновился. Обновите страницу и загрузите файл снова", status: 415 };
  }

  let name = "";
  try {
    name = decodeURIComponent(headers.get(UPLOAD_NAME_HEADER) ?? "").trim();
  } catch {
    name = "";
  }
  if (!name) return { error: "Файл не выбран", status: 400 };

  const length = headers.get("content-length");
  const declaredBytes = length != null && /^\d+$/.test(length) ? Number(length) : null;
  if (declaredBytes === 0) return { error: UPLOAD_EMPTY, status: 400 };
  if (declaredBytes != null && declaredBytes > MAX_UPLOAD_BYTES) {
    return { error: UPLOAD_TOO_LARGE, status: 400 };
  }

  return {
    name: name.slice(0, 255),
    type: contentType === "application/octet-stream" ? "" : contentType,
    declaredBytes,
    contractsOnly: headers.get(UPLOAD_SCOPE_HEADER) === "contract",
  };
}
