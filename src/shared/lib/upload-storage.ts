import path from "node:path";

/** Загруженные картинки лежат вне `public`: их отдаёт только маршрут `/uploads/` после проверки участника. */
export function uploadsRoot() {
  return path.join(process.cwd(), "storage", "uploads");
}

const PROJECT_ID = /^[A-Za-z0-9_-]+$/;
const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};
const UPLOAD_NAME = /^[A-Za-z0-9_-]+\.([a-z]+)$/;

/** Тип картинки по имени файла. Другое имя — `null`: такого файла загрузка не создаёт. */
export function uploadContentType(fileName: string): string | null {
  const ext = UPLOAD_NAME.exec(fileName)?.[1];
  return ext ? (IMAGE_TYPES[ext] ?? null) : null;
}

/** Путь на диске. Адрес с чужими символами — `null`, выйти из папки загрузок нельзя. */
export function uploadFilePath(root: string, projectId: string, fileName: string): string | null {
  if (!PROJECT_ID.test(projectId) || !uploadContentType(fileName)) return null;
  return path.join(root, projectId, fileName);
}
