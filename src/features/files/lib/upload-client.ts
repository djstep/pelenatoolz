import {
  MAX_UPLOAD_BYTES,
  UPLOAD_NAME_HEADER,
  UPLOAD_SCOPE_HEADER,
  UPLOAD_TOO_LARGE,
} from "@/features/files/lib/upload-request";

/** Файл уходит телом запроса без формы: сервер пишет его на диск по мере получения. */
export async function uploadProjectFile(
  projectId: string,
  route: "file" | "video",
  file: File,
  scope?: "contract",
) {
  // Отказ сервера пришёл бы посреди отправки и выглядел бы как обрыв связи.
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: UPLOAD_TOO_LARGE }, { status: 400 });
  }
  return fetch(`/api/projects/${projectId}/uploads/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      [UPLOAD_NAME_HEADER]: encodeURIComponent(file.name),
      ...(scope ? { [UPLOAD_SCOPE_HEADER]: scope } : {}),
    },
    body: file,
  });
}
