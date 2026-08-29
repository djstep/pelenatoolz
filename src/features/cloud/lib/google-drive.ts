import type { CloudEntry } from "@/features/cloud/lib/types";

const GOOGLE_FOLDER = "application/vnd.google-apps.folder";

export async function listGoogleDriveFolder(
  accessToken: string,
  folderId = "root",
): Promise<CloudEntry[]> {
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed = false`,
  );
  const fields = encodeURIComponent(
    "files(id,name,mimeType,size,modifiedTime,webViewLink)",
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=folder,name&pageSize=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Drive: ${res.status} ${text}`);
  }
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType?: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
    }>;
  };

  return (data.files ?? []).map((file) => ({
    id: file.id,
    name: file.name,
    kind: file.mimeType === GOOGLE_FOLDER ? "folder" : "file",
    mimeType: file.mimeType ?? null,
    sizeBytes: file.size ? Number(file.size) : null,
    modifiedAt: file.modifiedTime ?? null,
    webUrl: file.webViewLink ?? null,
  }));
}

export async function refreshGoogleToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status}`);
  }
  return (await res.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };
}

export async function fetchGoogleUserEmail(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email ?? null;
}

export async function downloadGoogleFile(
  accessToken: string,
  fileId: string,
  mimeType?: string | null,
) {
  const googleDoc = mimeType?.startsWith("application/vnd.google-apps.");
  let url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  let outMime = mimeType ?? "application/octet-stream";

  if (googleDoc) {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )}`;
    outMime =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google download failed: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: outMime };
}
