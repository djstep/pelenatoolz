import { createWriteStream } from "node:fs";
import { mkdir, open, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { ByteRange } from "@/features/files/lib/byte-range";

/**
 * Project file storage. Uses local disk by default.
 * When R2_* env vars are set, keys stay the same — swap put/get to S3 later.
 */
export function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

export function buildStorageKey(
  projectId: string,
  fileId: string,
  ext: string,
) {
  return `projects/${projectId}/files/${fileId}.${ext}`;
}

function localPath(storageKey: string) {
  return path.join(process.cwd(), "storage", storageKey);
}

export class UploadTooLargeError extends Error {}

/**
 * Пишет поток на диск, не держа файл в памяти: несколько больших проб не вытеснят базу.
 * Сначала во временный файл: оборванная загрузка не оставит половину файла под рабочим именем.
 * Такое расширение у загрузки быть не может: `safeExt` принимает не больше 8 символов. Копии его пропускают.
 * Больше `maxBytes` — отказ, размер считается по факту, а не по заголовку.
 */
export async function putProjectStream(
  storageKey: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  if (isR2Configured()) {
    // R2 wiring: install @aws-sdk/client-s3 and putObject here.
    // Until credentials are configured we fall through to local.
    console.warn(
      "[storage] R2 env present but S3 client not wired yet — writing locally",
    );
  }
  const full = localPath(storageKey);
  const partial = `${full}.uploading`;
  await mkdir(path.dirname(full), { recursive: true });

  let written = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      written += chunk.length;
      done(written > maxBytes ? new UploadTooLargeError() : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as NodeReadableStream), limit, createWriteStream(partial));
    await rename(partial, full);
    return written;
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error;
  }
}

/** Размер файла на диске; нет файла — `null`. */
export async function projectObjectSize(storageKey: string): Promise<number | null> {
  try {
    const info = await stat(localPath(storageKey));
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

const STREAM_CHUNK_BYTES = 256 * 1024;

/**
 * Файл или его кусок потоком: большое видео не читается в память целиком.
 * Файл открывается при первом чтении: на HEAD и при обрыве до отдачи Next тело не читает
 * и не отменяет, поэтому открытый заранее файл остался бы открытым навсегда.
 */
export function projectObjectStream(storageKey: string, range?: ByteRange): ReadableStream<Uint8Array> {
  const full = localPath(storageKey);
  const stop = range ? range.end + 1 : Number.POSITIVE_INFINITY;
  let position = range?.start ?? 0;
  let file: FileHandle | null = null;

  const closeFile = async () => {
    const opened = file;
    file = null;
    await opened?.close();
  };

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          file ??= await open(full, "r");
          const length = Math.min(STREAM_CHUNK_BYTES, stop - position);
          const chunk = Buffer.allocUnsafe(length);
          const { bytesRead } = length > 0 ? await file.read(chunk, 0, length, position) : { bytesRead: 0 };
          if (bytesRead === 0) {
            await closeFile();
            controller.close();
            return;
          }
          position += bytesRead;
          controller.enqueue(chunk.subarray(0, bytesRead));
        } catch (error) {
          await closeFile();
          throw error;
        }
      },
      cancel: closeFile,
    },
    { highWaterMark: 0 },
  );
}

export async function deleteProjectObject(storageKey: string): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(localPath(storageKey));
  } catch {
    /* missing file is fine */
  }
}

/** Public-facing URL served by our media API (works for local + later R2 proxy). */
export function mediaApiUrl(projectId: string, fileId: string) {
  return `/api/projects/${projectId}/media/${fileId}`;
}
