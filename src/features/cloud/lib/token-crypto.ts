import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "crypto";

const DEV_CLOUD_SECRET = "dev-cloud-secret-change-me";
const MIN_CLOUD_SECRET_LENGTH = 32;
/** Сколько живёт подписанный state OAuth: от кнопки «Подключить» до ответа Google/Яндекса. */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

let warnedDevCloudSecret = false;

/**
 * Секрет для шифрования токенов дисков и подписи state: CLOUD_TOKEN_SECRET,
 * если его нет — AUTH_SECRET. Проверяется при шифровании, а не при импорте,
 * чтобы сборка без секрета не падала.
 */
function cloudSecret() {
  const secret =
    process.env.CLOUD_TOKEN_SECRET || process.env.AUTH_SECRET || "";

  if (process.env.NODE_ENV === "production") {
    if (secret.trim().length < MIN_CLOUD_SECRET_LENGTH) {
      throw new Error(
        "Не задан секрет шифрования облачных дисков: укажите CLOUD_TOKEN_SECRET (или AUTH_SECRET) длиной не меньше 32 символов",
      );
    }
    return secret;
  }

  if (!secret.trim()) {
    if (!warnedDevCloudSecret) {
      warnedDevCloudSecret = true;
      console.warn(
        "CLOUD_TOKEN_SECRET и AUTH_SECRET не заданы: токены дисков шифруются ключом для разработки",
      );
    }
    return DEV_CLOUD_SECRET;
  }
  return secret;
}

function secretKey() {
  return scryptSync(cloudSecret(), "pelena-cloud", 32);
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
  /** Время выпуска, мс. State старше OAUTH_STATE_TTL_MS не принимается. */
  issuedAt: number;
};

export function signOAuthState(payload: Omit<OAuthStatePayload, "issuedAt">) {
  const full: OAuthStatePayload = { ...payload, issuedAt: Date.now() };
  const data = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", cloudSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const [data, sig] = state.split(".");
  if (!data || !sig) return null;
  const expected = createHmac("sha256", cloudSecret())
    .update(data)
    .digest("base64url");
  if (sig !== expected) return null;
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(data, "base64url").toString("utf8"),
    ) as OAuthStatePayload;
  } catch {
    return null;
  }
  if (typeof payload.issuedAt !== "number") return null;
  const age = Date.now() - payload.issuedAt;
  // Небольшой запас на расхождение часов между инстансами.
  if (age < -60_000 || age > OAUTH_STATE_TTL_MS) return null;
  return payload;
}

export function appOrigin() {
  return (
    process.env.APP_URL?.replace(/\/$/, "") ??
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}
