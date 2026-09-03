import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

export async function putProjectObject(
  storageKey: string,
  data: Buffer,
  _mimeType: string,
): Promise<void> {
  if (isR2Configured()) {
    // R2 wiring: install @aws-sdk/client-s3 and putObject here.
    // Until credentials are configured we fall through to local.
    console.warn(
      "[storage] R2 env present but S3 client not wired yet — writing locally",
    );
  }
  const full = localPath(storageKey);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

export async function getProjectObject(
  storageKey: string,
): Promise<Buffer | null> {
  try {
    return await readFile(localPath(storageKey));
  } catch {
    return null;
  }
}

/** Public-facing URL served by our media API (works for local + later R2 proxy). */
export function mediaApiUrl(projectId: string, fileId: string) {
  return `/api/projects/${projectId}/media/${fileId}`;
}
