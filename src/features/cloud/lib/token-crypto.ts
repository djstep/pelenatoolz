import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "crypto";

function secretKey() {
  const secret =
    process.env.CLOUD_TOKEN_SECRET ??
    process.env.AUTH_SECRET ??
    "dev-cloud-secret-change-me";
  return scryptSync(secret, "pelena-cloud", 32);
}

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

export type OAuthStatePayload = {
  userId: string;
  projectId: string;
  provider: "GOOGLE_DRIVE" | "YANDEX_DISK";
  returnTo: string;
};

function signSecret() {
  return (
    process.env.CLOUD_TOKEN_SECRET ??
    process.env.AUTH_SECRET ??
    "dev-cloud-secret-change-me"
  );
}

export function signOAuthState(payload: OAuthStatePayload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", signSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const [data, sig] = state.split(".");
  if (!data || !sig) return null;
  const expected = createHmac("sha256", signSecret())
    .update(data)
    .digest("base64url");
  if (sig !== expected) return null;
  try {
    return JSON.parse(
      Buffer.from(data, "base64url").toString("utf8"),
    ) as OAuthStatePayload;
  } catch {
    return null;
  }
}

export function appOrigin() {
  return (
    process.env.APP_URL?.replace(/\/$/, "") ??
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}
