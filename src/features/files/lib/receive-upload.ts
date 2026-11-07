import "server-only";
import {
  deleteProjectObject,
  putProjectStream,
  UploadTooLargeError,
} from "@/features/files/lib/storage";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_EMPTY,
  UPLOAD_TOO_LARGE,
  type UploadRefusal,
} from "@/features/files/lib/upload-request";
import { prisma } from "@/shared/db/prisma";

/**
 * Пишет тело запроса в хранилище. Запись файла создана до этого: при отказе или обрыве она
 * удаляется, чтобы в разделе «Файлы» не оставалось строк без файла.
 */
export async function receiveUpload(
  fileId: string,
  storageKey: string,
  body: ReadableStream<Uint8Array> | null,
): Promise<{ sizeBytes: number } | UploadRefusal> {
  const discard = () => prisma.projectFile.delete({ where: { id: fileId } });
  if (!body) {
    await discard();
    return { error: UPLOAD_EMPTY, status: 400 };
  }

  let sizeBytes = 0;
  try {
    sizeBytes = await putProjectStream(storageKey, body, MAX_UPLOAD_BYTES);
  } catch (error) {
    await discard();
    if (error instanceof UploadTooLargeError) return { error: UPLOAD_TOO_LARGE, status: 400 };
    throw error;
  }

  if (sizeBytes === 0) {
    await deleteProjectObject(storageKey);
    await discard();
    return { error: UPLOAD_EMPTY, status: 400 };
  }
  return { sizeBytes };
}
