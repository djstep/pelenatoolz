import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Заглушка Google и Яндекса для e2e и разработки: один сервер, два префикса.
 *   CLOUD_STUB_GOOGLE_URL = <url>/google   (см. src/features/cloud/lib/endpoints.ts)
 *   CLOUD_STUB_YANDEX_URL = <url>/yandex
 * Состояние — в памяти. Управление и проверка — `/__stub/...` (JSON):
 *   GET  /__stub/requests   — журнал запросов (бинарные тела — только размер и имя);
 *   GET  /__stub/state      — папки, файлы, доступы, публикации, отозванные токены;
 *   GET  /__stub/google/files/<id>/content, GET /__stub/yandex/content?path= — содержимое файла;
 *   POST /__stub/google/files/<id>/delete — файл «удалили руками» (дальше Google отвечает 404);
 *   POST /__stub/reset      — всё с нуля;
 *   POST /__stub/config     — аккаунт следующего входа, отказ в окне согласия, `failNext`.
 * Только `node:http`, без пакетов. Слушает 127.0.0.1.
 */

export type StubProvider = "google" | "yandex";

/**
 * Разовый отказ: следующий запрос `provider` с операцией `match` получит `status` и `body`.
 * `delayMs` — ответ придёт с задержкой (медленный Google / Яндекс); без `status` — только задержка,
 * сам запрос выполняется как обычно.
 * `match` — имя операции целиком (`token-refresh`, `permissions.create`, `resources.upload` …),
 * её начало до «-» / «.» (`token`, `files`, `permissions`) или `*`. `times` — сколько раз (по умолчанию 1).
 *
 * Операции Google: authorize, token-code, token-refresh, revoke, files.create, files.get, files.patch,
 *   files.upload, files.update, permissions.create, permissions.delete.
 * Операции Яндекса: authorize, token-code, token-refresh, revoke, info, resources.create, resources.get,
 *   resources.upload-link, resources.upload, resources.publish, resources.move.
 */
export type StubFailRule = {
  provider: StubProvider;
  match: string;
  status?: number;
  body?: unknown;
  times?: number;
  delayMs?: number;
};

export type StubGoogleAccount = { sub: string; email: string; scope: string };
export type StubYandexAccount = { id: string; login: string; email: string; scope: string };

export type StubConfig = {
  google: StubGoogleAccount & { authorizeError: string | null };
  yandex: StubYandexAccount & { authorizeError: string | null };
  failNext: StubFailRule[];
};

export type StubConfigPatch = {
  google?: Partial<StubConfig["google"]>;
  yandex?: Partial<StubConfig["yandex"]>;
  failNext?: StubFailRule[];
};

export type StubRequestLogEntry = {
  at: string;
  provider: StubProvider | "stub" | null;
  op: string | null;
  method: string;
  path: string;
  query: Record<string, string>;
  /** Вид авторизации (`Bearer` / `OAuth` / `Basic`) — без самого токена. */
  auth: string | null;
  body: unknown;
  status: number;
};

export const GOOGLE_STUB_DEFAULT_SCOPE =
  "https://www.googleapis.com/auth/drive.file openid https://www.googleapis.com/auth/userinfo.email";
export const YANDEX_STUB_DEFAULT_SCOPE = "cloud_api:disk.app_folder";

const GOOGLE_FOLDER = "application/vnd.google-apps.folder";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const SHEET_SOURCES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/vnd.oasis.opendocument.spreadsheet",
]);
const MAX_BODY = 25 * 1024 * 1024;

function defaultConfig(): StubConfig {
  return {
    google: {
      sub: "stub-google-sub-1",
      email: "stub-google@example.com",
      scope: GOOGLE_STUB_DEFAULT_SCOPE,
      authorizeError: null,
    },
    yandex: {
      id: "1000001",
      login: "stub-yandex",
      email: "stub-yandex@example.com",
      scope: YANDEX_STUB_DEFAULT_SCOPE,
      authorizeError: null,
    },
    failNext: [],
  };
}

// ---------- состояние ----------

type Grant = {
  id: string;
  provider: StubProvider;
  clientId: string | null;
  google: StubGoogleAccount | null;
  yandex: StubYandexAccount | null;
  revoked: boolean;
};

type PendingCode = { grant: Grant; redirectUri: string | null };

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  ownerSub: string;
  ownerEmail: string;
  size: number;
  contentVersion: number;
  sourceMimeType: string | null;
  content: Buffer | null;
};

type DrivePermission = {
  id: string;
  fileId: string;
  type: string;
  role: string;
  emailAddress: string;
  sendNotificationEmail: boolean;
};

type YandexResource = {
  ownerId: string;
  path: string;
  name: string;
  type: "dir" | "file";
  size: number;
  contentVersion: number;
  content: Buffer | null;
  publicKey: string | null;
};

type YandexUpload = { ownerId: string; path: string };

type State = {
  config: StubConfig;
  codes: Map<string, PendingCode>;
  /** токен (доступа или обновления) → разрешение */
  tokens: Map<string, { grant: Grant; kind: "access" | "refresh" }>;
  revokedTokens: { provider: StubProvider; token: string }[];
  driveFiles: Map<string, DriveFile>;
  drivePermissions: DrivePermission[];
  yandexResources: Map<string, YandexResource>;
  yandexUploads: Map<string, YandexUpload>;
  requests: StubRequestLogEntry[];
  seq: number;
};

function freshState(): State {
  return {
    config: defaultConfig(),
    codes: new Map(),
    tokens: new Map(),
    revokedTokens: [],
    driveFiles: new Map(),
    drivePermissions: [],
    yandexResources: new Map(),
    yandexUploads: new Map(),
    requests: [],
    seq: 0,
  };
}

const rand = (n = 12) => randomBytes(n).toString("base64url");

// ---------- http-помощники ----------

type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: Buffer;
  log: StubRequestLogEntry;
  /** Задержка ответа из `failNext` (`delayMs`). */
  delayMs?: number;
};

function send(ctx: Ctx, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (ctx.delayMs) {
    const ms = ctx.delayMs;
    ctx.delayMs = 0;
    setTimeout(() => send(ctx, status, body, headers), ms);
    return;
  }
  ctx.log.status = status;
  if (body === undefined || body === null) {
    ctx.res.writeHead(status, headers);
    ctx.res.end();
    return;
  }
  if (Buffer.isBuffer(body)) {
    ctx.res.writeHead(status, { "Content-Type": "application/octet-stream", ...headers });
    ctx.res.end(body);
    return;
  }
  if (typeof body === "string") {
    ctx.res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
    ctx.res.end(body);
    return;
  }
  ctx.res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  ctx.res.end(JSON.stringify(body));
}

function redirect(ctx: Ctx, location: string) {
  send(ctx, 302, null, { Location: location });
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function contentTypeOf(req: IncomingMessage) {
  return (req.headers["content-type"] ?? "").toLowerCase();
}

function formOf(ctx: Ctx): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(ctx.body.toString("utf8")));
}

function jsonOf(ctx: Ctx): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(ctx.body.toString("utf8") || "null");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type MultipartPart = { contentType: string; content: Buffer };

/** `multipart/related` (загрузка Google): части с заголовками и содержимым. */
function parseMultipart(body: Buffer, contentType: string): MultipartPart[] | null {
  const m = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!m) return null;
  const delim = Buffer.from(`--${m[1]}`);
  const parts: MultipartPart[] = [];
  let pos = body.indexOf(delim);
  if (pos < 0) return null;
  for (;;) {
    let start = pos + delim.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    if (body.subarray(start, start + 2).toString() === "\r\n") start += 2;
    const next = body.indexOf(delim, start);
    if (next < 0) return null;
    let end = next;
    if (body[end - 2] === 13 && body[end - 1] === 10) end -= 2;
    const part = body.subarray(start, end);
    const sep = part.indexOf("\r\n\r\n");
    if (sep < 0) return null;
    const headerText = part.subarray(0, sep).toString("utf8");
    const ct = /^content-type:\s*(.+)$/im.exec(headerText)?.[1]?.trim() ?? "application/octet-stream";
    parts.push({ contentType: ct, content: part.subarray(sep + 4) });
    pos = next;
  }
  return parts;
}

/** Тело для журнала: JSON / форма как есть (секрет клиента скрыт), бинарное — размер и имя. */
function bodySummary(req: IncomingMessage, body: Buffer, name: string | null): unknown {
  if (body.length === 0) return null;
  const ct = contentTypeOf(req);
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      return { contentType: ct, size: body.length };
    }
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    const form = Object.fromEntries(new URLSearchParams(body.toString("utf8")));
    if ("client_secret" in form) form.client_secret = "[скрыт]";
    return form;
  }
  if (ct.includes("multipart/related")) {
    const parts = parseMultipart(body, ct);
    if (!parts || parts.length < 2) return { contentType: ct, size: body.length };
    let metadata: unknown = null;
    try {
      metadata = JSON.parse(parts[0].content.toString("utf8") || "{}");
    } catch {
      metadata = null;
    }
    return { metadata, media: { contentType: parts[1].contentType, size: parts[1].content.length } };
  }
  return { contentType: ct || null, size: body.length, name };
}

function authOf(req: IncomingMessage): { scheme: string; token: string } | null {
  const raw = req.headers.authorization;
  if (!raw) return null;
  const m = /^(\S+)\s+(.+)$/.exec(raw.trim());
  return m ? { scheme: m[1], token: m[2] } : null;
}

// ---------- сервер ----------

export type CloudStub = {
  /** http://127.0.0.1:PORT */
  url: string;
  /** Значение для CLOUD_STUB_GOOGLE_URL. */
  googleUrl: string;
  /** Значение для CLOUD_STUB_YANDEX_URL. */
  yandexUrl: string;
  close(): Promise<void>;
};

export async function startCloudStub(opts: { port?: number; appOrigin?: string } = {}): Promise<CloudStub> {
  let state = freshState();
  let base = "";
  const appOrigin = opts.appOrigin?.replace(/\/+$/, "") ?? null;

  const takeFail = (provider: StubProvider, op: string): StubFailRule | null => {
    const i = state.config.failNext.findIndex(
      (r) =>
        r.provider === provider &&
        (r.match === "*" || r.match === op || op.startsWith(`${r.match}-`) || op.startsWith(`${r.match}.`)),
    );
    if (i < 0) return null;
    const rule = state.config.failNext[i];
    const left = (rule.times ?? 1) - 1;
    if (left <= 0) state.config.failNext.splice(i, 1);
    else state.config.failNext[i] = { ...rule, times: left };
    return rule;
  };

  const failBody = (provider: StubProvider, op: string, status: number): unknown => {
    if (op.startsWith("token")) return { error: "invalid_grant", error_description: "Stub failure" };
    if (provider === "yandex") return { error: "StubError", message: "Stub failure", description: "Stub failure" };
    const reason =
      status === 401 ? "authError" : status === 403 ? "forbidden" : status === 404 ? "notFound" : status === 429 ? "rateLimitExceeded" : "backendError";
    return { error: { code: status, message: "Stub failure", errors: [{ domain: "global", reason, message: "Stub failure" }] } };
  };

  /** Операция с учётом `failNext`: true — отказ уже отправлен. */
  const failed = (ctx: Ctx, provider: StubProvider, op: string) => {
    ctx.log.provider = provider;
    ctx.log.op = op;
    const rule = takeFail(provider, op);
    if (!rule) return false;
    if (rule.delayMs) ctx.delayMs = rule.delayMs;
    if (!rule.status) return false;
    send(ctx, rule.status, rule.body ?? failBody(provider, op, rule.status));
    return true;
  };

  const redirectAllowed = (redirectUri: string) => {
    if (!appOrigin) return true;
    try {
      return new URL(redirectUri).origin === new URL(appOrigin).origin;
    } catch {
      return false;
    }
  };

  const issueTokens = (grant: Grant) => {
    const prefix = grant.provider === "google" ? "g" : "y";
    const accessToken = `${prefix}-at-${rand()}`;
    const refreshToken = `${prefix}-rt-${rand()}`;
    state.tokens.set(accessToken, { grant, kind: "access" });
    state.tokens.set(refreshToken, { grant, kind: "refresh" });
    return { accessToken, refreshToken };
  };

  const revokeToken = (provider: StubProvider, token: string) => {
    const t = state.tokens.get(token);
    if (!t || t.grant.provider !== provider) return false;
    // Как у Google: отзыв любого токена отзывает всё разрешение приложения в аккаунте —
    // все выдачи этого аккаунта этому клиенту (и токены обновления). У Яндекса — только эта выдача
    // (токен одного устройства).
    t.grant.revoked = true;
    if (provider === "google") {
      for (const other of state.tokens.values()) {
        const g = other.grant;
        if (g.provider === "google" && g.google?.sub === t.grant.google?.sub && g.clientId === t.grant.clientId) {
          g.revoked = true;
        }
      }
    }
    state.revokedTokens.push({ provider, token });
    return true;
  };

  const liveGrant = (provider: StubProvider, token: string | undefined, kind: "access" | "refresh") => {
    if (!token) return null;
    const t = state.tokens.get(token);
    if (!t || t.kind !== kind || t.grant.provider !== provider || t.grant.revoked) return null;
    return t.grant;
  };

  // ---------- Google ----------

  const googleError = (ctx: Ctx, status: number, reason: string, message: string, extra: Record<string, unknown> = {}) =>
    send(ctx, status, { error: { code: status, message, errors: [{ domain: "global", reason, message }], ...extra } });

  const idToken = (grant: Grant) => {
    const acc = grant.google!;
    const now = Math.floor(Date.now() / 1000);
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const payload = {
      iss: "https://accounts.google.com",
      azp: grant.clientId ?? "stub-client",
      aud: grant.clientId ?? "stub-client",
      sub: acc.sub,
      email: acc.email,
      email_verified: true,
      iat: now,
      exp: now + 3600,
    };
    return `${enc({ alg: "RS256", kid: "stub", typ: "JWT" })}.${enc(payload)}.${Buffer.from("stub-signature").toString("base64url")}`;
  };

  const webViewLink = (f: DriveFile) => {
    const kind = f.mimeType === GOOGLE_FOLDER ? "folders" : f.mimeType === GOOGLE_SHEET ? "spreadsheets" : "file";
    return `${base}/google/view/${kind}/${f.id}`;
  };

  const driveFileJson = (f: DriveFile) => ({
    kind: "drive#file",
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    parents: f.parents,
    trashed: f.trashed,
    webViewLink: webViewLink(f),
  });

  const hasScope = (grant: Grant, need: "read" | "write") => {
    const scopes = (grant.google?.scope ?? "").split(/\s+/);
    const write =
      scopes.includes("https://www.googleapis.com/auth/drive.file") ||
      scopes.includes("https://www.googleapis.com/auth/drive");
    if (need === "write") return write;
    return write || scopes.includes("https://www.googleapis.com/auth/drive.readonly");
  };

  /** Bearer → разрешение; иначе ответ 401/403 уже отправлен. */
  const driveAuth = (ctx: Ctx, need: "read" | "write"): Grant | null => {
    const auth = authOf(ctx.req);
    const grant = auth?.scheme === "Bearer" ? liveGrant("google", auth.token, "access") : null;
    if (!grant) {
      googleError(ctx, 401, "authError", "Request had invalid authentication credentials.", {
        status: "UNAUTHENTICATED",
      });
      return null;
    }
    if (!hasScope(grant, need)) {
      googleError(ctx, 403, "insufficientPermissions", "Request had insufficient authentication scopes.", {
        status: "PERMISSION_DENIED",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
      });
      return null;
    }
    return grant;
  };

  /** Файл, видимый этому аккаунту (`drive.file`: свои файлы); иначе 404 уже отправлен. */
  const ownFile = (ctx: Ctx, grant: Grant, id: string): DriveFile | null => {
    const f = state.driveFiles.get(id);
    if (!f || f.ownerSub !== grant.google!.sub) {
      googleError(ctx, 404, "notFound", `File not found: ${id}.`);
      return null;
    }
    return f;
  };

  const parentsOk = (ctx: Ctx, grant: Grant, parents: unknown): string[] | null => {
    if (parents === undefined) return [];
    if (!Array.isArray(parents) || parents.some((p) => typeof p !== "string")) {
      googleError(ctx, 400, "invalid", "Invalid parents.");
      return null;
    }
    for (const p of parents as string[]) {
      const f = state.driveFiles.get(p);
      if (!f || f.ownerSub !== grant.google!.sub || f.mimeType !== GOOGLE_FOLDER) {
        googleError(ctx, 404, "notFound", `File not found: ${p}.`);
        return null;
      }
    }
    return parents as string[];
  };

  const newDriveId = () => `gf${++state.seq}${rand(6)}`;

  const handleGoogle = (ctx: Ctx, path: string) => {
    const { req, url } = ctx;
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/o/oauth2/v2/auth") {
      if (failed(ctx, "google", "authorize")) return;
      const redirectUri = url.searchParams.get("redirect_uri");
      const stateParam = url.searchParams.get("state") ?? "";
      if (!redirectUri || !redirectAllowed(redirectUri)) {
        send(ctx, 400, "<h1>Error 400: redirect_uri_mismatch</h1>");
        return;
      }
      const target = new URL(redirectUri);
      const err = state.config.google.authorizeError;
      if (err) {
        state.config.google.authorizeError = null;
        target.searchParams.set("error", err);
      } else {
        const { sub, email, scope } = state.config.google;
        const account: StubGoogleAccount = { sub, email, scope };
        const grant: Grant = {
          id: rand(),
          provider: "google",
          clientId: url.searchParams.get("client_id"),
          google: account,
          yandex: null,
          revoked: false,
        };
        const code = `g-code-${rand()}`;
        state.codes.set(code, { grant, redirectUri });
        target.searchParams.set("code", code);
        target.searchParams.set("scope", account.scope);
      }
      target.searchParams.set("state", stateParam);
      redirect(ctx, target.toString());
      return;
    }

    if (method === "POST" && path === "/token") {
      const form = formOf(ctx);
      if (form.grant_type === "authorization_code") {
        if (failed(ctx, "google", "token-code")) return;
        const pending = form.code ? state.codes.get(form.code) : undefined;
        if (!pending || pending.grant.provider !== "google") {
          send(ctx, 400, { error: "invalid_grant", error_description: "Malformed auth code." });
          return;
        }
        state.codes.delete(form.code);
        if (pending.redirectUri && form.redirect_uri !== pending.redirectUri) {
          send(ctx, 400, { error: "redirect_uri_mismatch", error_description: "Bad Request" });
          return;
        }
        const { accessToken, refreshToken } = issueTokens(pending.grant);
        send(ctx, 200, {
          access_token: accessToken,
          expires_in: 3599,
          refresh_token: refreshToken,
          scope: pending.grant.google!.scope,
          token_type: "Bearer",
          id_token: idToken(pending.grant),
        });
        return;
      }
      if (form.grant_type === "refresh_token") {
        if (failed(ctx, "google", "token-refresh")) return;
        const grant = liveGrant("google", form.refresh_token, "refresh");
        if (!grant) {
          send(ctx, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
          return;
        }
        const accessToken = `g-at-${rand()}`;
        state.tokens.set(accessToken, { grant, kind: "access" });
        send(ctx, 200, {
          access_token: accessToken,
          expires_in: 3599,
          scope: grant.google!.scope,
          token_type: "Bearer",
          id_token: idToken(grant),
        });
        return;
      }
      send(ctx, 400, { error: "unsupported_grant_type", error_description: "Invalid grant_type." });
      return;
    }

    if (method === "POST" && path === "/revoke") {
      if (failed(ctx, "google", "revoke")) return;
      const token = formOf(ctx).token ?? url.searchParams.get("token") ?? "";
      if (!revokeToken("google", token)) {
        send(ctx, 400, { error: "invalid_token", error_description: "Token expired or revoked" });
        return;
      }
      send(ctx, 200, {});
      return;
    }

    if (method === "GET" && path.startsWith("/view/")) {
      send(ctx, 200, `<!doctype html><meta charset="utf-8"><title>Заглушка Google</title><p>Заглушка Google: ${path}</p>`);
      return;
    }

    // --- Drive: файлы (метаданные) ---
    if (path === "/drive/v3/files" && method === "POST") {
      if (failed(ctx, "google", "files.create")) return;
      const grant = driveAuth(ctx, "write");
      if (!grant) return;
      const meta = jsonOf(ctx) ?? {};
      const parents = parentsOk(ctx, grant, meta.parents);
      if (!parents) return;
      const f: DriveFile = {
        id: newDriveId(),
        name: typeof meta.name === "string" ? meta.name : "Untitled",
        mimeType: typeof meta.mimeType === "string" ? meta.mimeType : "application/octet-stream",
        parents,
        trashed: false,
        ownerSub: grant.google!.sub,
        ownerEmail: grant.google!.email,
        size: 0,
        contentVersion: 0,
        sourceMimeType: null,
        content: null,
      };
      state.driveFiles.set(f.id, f);
      send(ctx, 200, driveFileJson(f));
      return;
    }

    const permOne = /^\/drive\/v3\/files\/([^/]+)\/permissions\/([^/]+)$/.exec(path);
    if (permOne && method === "DELETE") {
      if (failed(ctx, "google", "permissions.delete")) return;
      const grant = driveAuth(ctx, "write");
      if (!grant) return;
      const fileId = decodeURIComponent(permOne[1]);
      const permId = decodeURIComponent(permOne[2]);
      if (!ownFile(ctx, grant, fileId)) return;
      const i = state.drivePermissions.findIndex((p) => p.fileId === fileId && p.id === permId);
      if (i < 0) {
        googleError(ctx, 404, "notFound", `Permission not found: ${permId}.`);
        return;
      }
      state.drivePermissions.splice(i, 1);
      send(ctx, 204, null);
      return;
    }

    const permList = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(path);
    if (permList && method === "POST") {
      if (failed(ctx, "google", "permissions.create")) return;
      const grant = driveAuth(ctx, "write");
      if (!grant) return;
      const fileId = decodeURIComponent(permList[1]);
      if (!ownFile(ctx, grant, fileId)) return;
      const body = jsonOf(ctx) ?? {};
      const role = body.role;
      const email = typeof body.emailAddress === "string" ? body.emailAddress.trim() : "";
      if (body.type !== "user" || !email || !["reader", "commenter", "writer"].includes(String(role))) {
        googleError(ctx, 400, "invalid", "Invalid permission.");
        return;
      }
      // У Google id доступа пользователя один и тот же для всех файлов; повтор — обновление роли.
      const id = `perm-${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16)}`;
      const existing = state.drivePermissions.find((p) => p.fileId === fileId && p.id === id);
      const sendNotificationEmail = url.searchParams.get("sendNotificationEmail") !== "false";
      if (existing) {
        existing.role = String(role);
        existing.sendNotificationEmail = sendNotificationEmail;
      } else {
        state.drivePermissions.push({ id, fileId, type: "user", role: String(role), emailAddress: email, sendNotificationEmail });
      }
      send(ctx, 200, { kind: "drive#permission", id, type: "user", role });
      return;
    }

    const fileOne = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (fileOne && method === "GET") {
      if (failed(ctx, "google", "files.get")) return;
      const grant = driveAuth(ctx, "read");
      if (!grant) return;
      const f = ownFile(ctx, grant, decodeURIComponent(fileOne[1]));
      if (!f) return;
      send(ctx, 200, driveFileJson(f));
      return;
    }
    if (fileOne && method === "PATCH") {
      if (failed(ctx, "google", "files.patch")) return;
      const grant = driveAuth(ctx, "write");
      if (!grant) return;
      const f = ownFile(ctx, grant, decodeURIComponent(fileOne[1]));
      if (!f) return;
      const patch = jsonOf(ctx) ?? {};
      if (typeof patch.name === "string") f.name = patch.name;
      if (typeof patch.trashed === "boolean") f.trashed = patch.trashed;
      send(ctx, 200, driveFileJson(f));
      return;
    }

    // --- Drive: загрузка содержимого ---
    const uploadOne = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(path);
    if (uploadOne && (method === "POST" || method === "PATCH")) {
      const isUpdate = method === "PATCH";
      if (isUpdate !== Boolean(uploadOne[1])) {
        googleError(ctx, 404, "notFound", "Not Found");
        return;
      }
      if (failed(ctx, "google", isUpdate ? "files.update" : "files.upload")) return;
      const grant = driveAuth(ctx, "write");
      if (!grant) return;
      if (url.searchParams.get("uploadType") !== "multipart") {
        googleError(ctx, 400, "badRequest", "Stub supports only uploadType=multipart.");
        return;
      }
      const parts = parseMultipart(ctx.body, contentTypeOf(ctx.req));
      if (!parts || parts.length < 2) {
        googleError(ctx, 400, "badContent", "Malformed multipart body.");
        return;
      }
      let meta: Record<string, unknown>;
      try {
        const v: unknown = JSON.parse(parts[0].content.toString("utf8") || "{}");
        meta = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      } catch {
        googleError(ctx, 400, "parseError", "Parse Error");
        return;
      }
      const media = parts[1];
      const mediaType = media.contentType.split(";")[0].trim().toLowerCase();

      if (isUpdate) {
        const f = ownFile(ctx, grant, decodeURIComponent(uploadOne[1]!));
        if (!f) return;
        if (typeof meta.name === "string") f.name = meta.name;
        // Как у Google: id не меняется; Google Таблица остаётся таблицей (xlsx импортируется в неё).
        if (f.mimeType === GOOGLE_SHEET && !SHEET_SOURCES.has(mediaType)) {
          googleError(ctx, 400, "badContent", "Unsupported content for a spreadsheet.");
          return;
        }
        if (f.mimeType !== GOOGLE_SHEET && !f.mimeType.startsWith("application/vnd.google-apps.")) {
          f.mimeType = mediaType;
        }
        f.content = Buffer.from(media.content);
        f.size = media.content.length;
        f.sourceMimeType = mediaType;
        f.contentVersion += 1;
        send(ctx, 200, driveFileJson(f));
        return;
      }

      const parents = parentsOk(ctx, grant, meta.parents);
      if (!parents) return;
      const target = typeof meta.mimeType === "string" ? meta.mimeType : mediaType;
      if (target === GOOGLE_SHEET && !SHEET_SOURCES.has(mediaType)) {
        googleError(ctx, 400, "badContent", "Unsupported conversion.");
        return;
      }
      const f: DriveFile = {
        id: newDriveId(),
        name: typeof meta.name === "string" ? meta.name : "Untitled",
        mimeType: target,
        parents,
        trashed: false,
        ownerSub: grant.google!.sub,
        ownerEmail: grant.google!.email,
        size: media.content.length,
        contentVersion: 1,
        sourceMimeType: mediaType,
        content: Buffer.from(media.content),
      };
      state.driveFiles.set(f.id, f);
      send(ctx, 200, driveFileJson(f));
      return;
    }

    googleError(ctx, 404, "notFound", "Not Found");
  };

  // ---------- Яндекс ----------

  const yandexError = (ctx: Ctx, status: number, error: string, description: string) =>
    send(ctx, status, { message: description, description, error });

  const normPath = (raw: string | null): string | null => {
    if (!raw) return null;
    const m = /^(app:|disk:)\/*(.*)$/.exec(raw.trim());
    if (!m) return null;
    const rest = m[2].split("/").filter(Boolean).join("/");
    return `${m[1]}/${rest}`;
  };
  const isRoot = (p: string) => p === "app:/" || p === "disk:/";
  const parentOf = (p: string) => {
    const i = p.lastIndexOf("/");
    const head = p.slice(0, i);
    return head.endsWith(":") ? `${head}/` : head;
  };
  const resKey = (ownerId: string, p: string) => `${ownerId}|${p}`;

  const yandexAuth = (ctx: Ctx): Grant | null => {
    const auth = authOf(ctx.req);
    const grant = auth?.scheme === "OAuth" ? liveGrant("yandex", auth.token, "access") : null;
    if (!grant) {
      yandexError(ctx, 401, "UnauthorizedError", "Unauthorized");
      return null;
    }
    return grant;
  };

  /** Права: `disk.app_folder` — только `app:/`; `disk.write` — всё; `disk.read` — только чтение. */
  const yandexPathAllowed = (ctx: Ctx, grant: Grant, p: string, write: boolean) => {
    const scopes = (grant.yandex?.scope ?? "").split(/\s+/);
    const ok =
      scopes.includes("cloud_api:disk.write") ||
      (scopes.includes("cloud_api:disk.app_folder") && p.startsWith("app:/")) ||
      (!write && scopes.includes("cloud_api:disk.read"));
    if (!ok) yandexError(ctx, 403, "DiskForbiddenError", "Forbidden");
    return ok;
  };

  const resourceJson = (r: YandexResource) => {
    const out: Record<string, unknown> = { path: r.path, name: r.name, type: r.type };
    if (r.type === "file") {
      out.size = r.size;
      out.mime_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
    if (r.publicKey) {
      out.public_key = r.publicKey;
      out.public_url = `${base}/yandex/public/${r.publicKey}`;
    }
    if (r.type === "dir") {
      const items = [...state.yandexResources.values()]
        .filter((x) => x.ownerId === r.ownerId && parentOf(x.path) === r.path)
        .map((x) => ({ path: x.path, name: x.name, type: x.type }));
      out._embedded = { path: r.path, items, total: items.length };
    }
    return out;
  };

  const dirExists = (ownerId: string, p: string) => {
    if (isRoot(p)) return true;
    return state.yandexResources.get(resKey(ownerId, p))?.type === "dir";
  };

  const handleYandex = (ctx: Ctx, path: string) => {
    const { req, url } = ctx;
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/authorize") {
      if (failed(ctx, "yandex", "authorize")) return;
      const redirectUri =
        url.searchParams.get("redirect_uri") ?? (appOrigin ? `${appOrigin}/api/cloud/yandex/callback` : null);
      const stateParam = url.searchParams.get("state") ?? "";
      if (!redirectUri || !redirectAllowed(redirectUri)) {
        send(ctx, 400, "<h1>redirect_uri не совпадает</h1>");
        return;
      }
      const target = new URL(redirectUri);
      const err = state.config.yandex.authorizeError;
      if (err) {
        state.config.yandex.authorizeError = null;
        target.searchParams.set("error", err);
      } else {
        const { id, login, email, scope } = state.config.yandex;
        const grant: Grant = {
          id: rand(),
          provider: "yandex",
          clientId: url.searchParams.get("client_id"),
          google: null,
          yandex: { id, login, email, scope },
          revoked: false,
        };
        const code = `y-code-${rand(6)}`;
        state.codes.set(code, { grant, redirectUri: url.searchParams.get("redirect_uri") });
        target.searchParams.set("code", code);
      }
      target.searchParams.set("state", stateParam);
      redirect(ctx, target.toString());
      return;
    }

    if (method === "POST" && path === "/token") {
      const form = formOf(ctx);
      if (form.grant_type === "authorization_code") {
        if (failed(ctx, "yandex", "token-code")) return;
        const pending = form.code ? state.codes.get(form.code) : undefined;
        if (!pending || pending.grant.provider !== "yandex") {
          send(ctx, 400, { error: "invalid_grant", error_description: "Code has expired" });
          return;
        }
        state.codes.delete(form.code);
        const { accessToken, refreshToken } = issueTokens(pending.grant);
        send(ctx, 200, {
          token_type: "bearer",
          access_token: accessToken,
          expires_in: 31536000,
          refresh_token: refreshToken,
          scope: pending.grant.yandex!.scope,
        });
        return;
      }
      if (form.grant_type === "refresh_token") {
        if (failed(ctx, "yandex", "token-refresh")) return;
        const grant = liveGrant("yandex", form.refresh_token, "refresh");
        if (!grant) {
          send(ctx, 400, { error: "invalid_grant", error_description: "Token has been revoked" });
          return;
        }
        const { accessToken, refreshToken } = issueTokens(grant);
        send(ctx, 200, {
          token_type: "bearer",
          access_token: accessToken,
          expires_in: 31536000,
          refresh_token: refreshToken,
          scope: grant.yandex!.scope,
        });
        return;
      }
      send(ctx, 400, { error: "unsupported_grant_type", error_description: "Unsupported grant_type" });
      return;
    }

    if (method === "POST" && path === "/revoke_token") {
      if (failed(ctx, "yandex", "revoke")) return;
      const token = formOf(ctx).access_token ?? "";
      if (!revokeToken("yandex", token)) {
        send(ctx, 400, { error: "invalid_token", error_description: "Token not found" });
        return;
      }
      send(ctx, 200, { status: "ok" });
      return;
    }

    if (method === "GET" && path === "/info") {
      if (failed(ctx, "yandex", "info")) return;
      const auth = authOf(req);
      const grant = auth?.scheme === "OAuth" ? liveGrant("yandex", auth.token, "access") : null;
      if (!grant) {
        send(ctx, 401, "<h1>401 Unauthorized</h1>");
        return;
      }
      const acc = grant.yandex!;
      send(ctx, 200, {
        id: acc.id,
        login: acc.login,
        client_id: grant.clientId ?? "stub-client",
        default_email: acc.email,
        emails: [acc.email],
        psuid: `stub-psuid-${acc.id}`,
      });
      return;
    }

    if (method === "GET" && path.startsWith("/public/")) {
      send(ctx, 200, `<!doctype html><meta charset="utf-8"><title>Заглушка Яндекса</title><p>Публичная ссылка: ${path}</p>`);
      return;
    }

    const uploadTarget = /^\/__upload\/([^/]+)$/.exec(path);
    if (uploadTarget && method === "PUT") {
      if (failed(ctx, "yandex", "resources.upload")) return;
      const up = state.yandexUploads.get(uploadTarget[1]);
      if (!up) {
        send(ctx, 404, { error: "UploadNotFound" });
        return;
      }
      state.yandexUploads.delete(uploadTarget[1]);
      ctx.log.body = { contentType: contentTypeOf(req) || null, size: ctx.body.length, name: up.path };
      const key = resKey(up.ownerId, up.path);
      const prev = state.yandexResources.get(key);
      state.yandexResources.set(key, {
        ownerId: up.ownerId,
        path: up.path,
        name: up.path.slice(up.path.lastIndexOf("/") + 1),
        type: "file",
        size: ctx.body.length,
        contentVersion: (prev?.contentVersion ?? 0) + 1,
        content: Buffer.from(ctx.body),
        publicKey: prev?.publicKey ?? null,
      });
      send(ctx, 201, null);
      return;
    }

    if (
      path === "/v1/disk/resources" ||
      path === "/v1/disk/resources/upload" ||
      path === "/v1/disk/resources/publish" ||
      path === "/v1/disk/resources/move"
    ) {
      const sub = path.slice("/v1/disk/resources".length);
      const op =
        sub === "/upload"
          ? "resources.upload-link"
          : sub === "/publish"
            ? "resources.publish"
            : sub === "/move"
              ? "resources.move"
              : method === "PUT"
                ? "resources.create"
                : "resources.get";
      const expected =
        op === "resources.get" || op === "resources.upload-link" ? "GET" : op === "resources.move" ? "POST" : "PUT";
      if (method !== expected) {
        yandexError(ctx, 405, "MethodNotAllowedError", "Method not allowed");
        return;
      }
      if (failed(ctx, "yandex", op)) return;
      const grant = yandexAuth(ctx);
      if (!grant) return;
      const ownerId = grant.yandex!.id;
      const p = normPath(url.searchParams.get("path"));
      if (!p) {
        yandexError(ctx, 400, "FieldValidationError", "Error validating field \"path\"");
        return;
      }
      if (!yandexPathAllowed(ctx, grant, p, op !== "resources.get")) return;
      const existing = state.yandexResources.get(resKey(ownerId, p));
      const selfHref = `${base}/yandex/v1/disk/resources?path=${encodeURIComponent(p)}`;

      if (op === "resources.get") {
        if (isRoot(p)) {
          send(ctx, 200, resourceJson({ ownerId, path: p, name: "", type: "dir", size: 0, contentVersion: 0, content: null, publicKey: null }));
          return;
        }
        if (!existing) {
          yandexError(ctx, 404, "DiskNotFoundError", "Resource not found.");
          return;
        }
        send(ctx, 200, resourceJson(existing));
        return;
      }

      if (op === "resources.create") {
        if (isRoot(p) || existing) {
          yandexError(ctx, 409, "DiskPathPointsToExistentDirectoryError", "Specified path points to existent directory.");
          return;
        }
        if (!dirExists(ownerId, parentOf(p))) {
          yandexError(ctx, 409, "DiskPathDoesntExistsError", "Specified path doesn't exists.");
          return;
        }
        state.yandexResources.set(resKey(ownerId, p), {
          ownerId,
          path: p,
          name: p.slice(p.lastIndexOf("/") + 1),
          type: "dir",
          size: 0,
          contentVersion: 0,
          content: null,
          publicKey: null,
        });
        send(ctx, 201, { href: selfHref, method: "GET", templated: false });
        return;
      }

      if (op === "resources.upload-link") {
        if (!dirExists(ownerId, parentOf(p))) {
          yandexError(ctx, 409, "DiskPathDoesntExistsError", "Specified path doesn't exists.");
          return;
        }
        if (existing && url.searchParams.get("overwrite") !== "true") {
          yandexError(ctx, 409, "DiskResourceAlreadyExistsError", "Resource already exists.");
          return;
        }
        if (existing?.type === "dir") {
          yandexError(ctx, 409, "DiskResourceAlreadyExistsError", "Resource already exists.");
          return;
        }
        const id = rand();
        state.yandexUploads.set(id, { ownerId, path: p });
        send(ctx, 200, { operation_id: `op-${id}`, href: `${base}/yandex/__upload/${id}`, method: "PUT", templated: false });
        return;
      }

      if (op === "resources.move") {
        const from = normPath(url.searchParams.get("from"));
        if (!from || !yandexPathAllowed(ctx, grant, from, true)) {
          if (!from) yandexError(ctx, 400, "FieldValidationError", "Error validating field \"from\"");
          return;
        }
        const source = state.yandexResources.get(resKey(ownerId, from));
        if (!source) {
          yandexError(ctx, 404, "DiskNotFoundError", "Resource not found.");
          return;
        }
        if (!dirExists(ownerId, parentOf(p))) {
          yandexError(ctx, 409, "DiskPathDoesntExistsError", "Specified path doesn't exists.");
          return;
        }
        if (from !== p && existing && url.searchParams.get("overwrite") !== "true") {
          yandexError(ctx, 409, "DiskResourceAlreadyExistsError", "Resource already exists.");
          return;
        }
        // Папка переносится вместе со всем, что в ней.
        for (const r of [...state.yandexResources.values()]) {
          if (r.ownerId !== ownerId || (r.path !== from && !r.path.startsWith(`${from}/`))) continue;
          state.yandexResources.delete(resKey(ownerId, r.path));
          const moved = `${p}${r.path.slice(from.length)}`;
          state.yandexResources.set(resKey(ownerId, moved), {
            ...r,
            path: moved,
            name: moved.slice(moved.lastIndexOf("/") + 1),
          });
        }
        send(ctx, 201, { href: selfHref, method: "GET", templated: false });
        return;
      }

      // resources.publish
      if (!existing) {
        yandexError(ctx, 404, "DiskNotFoundError", "Resource not found.");
        return;
      }
      if (!existing.publicKey) existing.publicKey = rand(9);
      send(ctx, 200, { href: selfHref, method: "GET", templated: false });
      return;
    }

    yandexError(ctx, 404, "NotFoundError", "Not found");
  };

  // ---------- управление ----------

  const stateJson = () => ({
    google: {
      files: [...state.driveFiles.values()].map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        parents: f.parents,
        trashed: f.trashed,
        size: f.size,
        contentVersion: f.contentVersion,
        sourceMimeType: f.sourceMimeType,
        ownerSub: f.ownerSub,
        ownerEmail: f.ownerEmail,
        webViewLink: webViewLink(f),
      })),
      permissions: state.drivePermissions.map((p) => ({ ...p })),
      revokedTokens: state.revokedTokens.filter((t) => t.provider === "google").map((t) => t.token),
    },
    yandex: {
      resources: [...state.yandexResources.values()].map((r) => ({
        ownerId: r.ownerId,
        path: r.path,
        name: r.name,
        type: r.type,
        size: r.size,
        contentVersion: r.contentVersion,
        publicUrl: r.publicKey ? `${base}/yandex/public/${r.publicKey}` : null,
      })),
      published: [...state.yandexResources.values()]
        .filter((r) => r.publicKey)
        .map((r) => ({ ownerId: r.ownerId, path: r.path, publicUrl: `${base}/yandex/public/${r.publicKey}` })),
      revokedTokens: state.revokedTokens.filter((t) => t.provider === "yandex").map((t) => t.token),
    },
  });

  const applyConfig = (patch: StubConfigPatch) => {
    if (patch.google) state.config.google = { ...state.config.google, ...patch.google };
    if (patch.yandex) state.config.yandex = { ...state.config.yandex, ...patch.yandex };
    if (Array.isArray(patch.failNext)) state.config.failNext.push(...patch.failNext);
  };

  const handleStub = (ctx: Ctx, path: string) => {
    const method = ctx.req.method ?? "GET";
    ctx.log.provider = "stub";
    if (method === "GET" && path === "/requests") return send(ctx, 200, state.requests);
    if (method === "GET" && path === "/state") return send(ctx, 200, stateJson());
    if (method === "GET" && path === "/config") return send(ctx, 200, state.config);
    if (method === "POST" && path === "/reset") {
      state = freshState();
      return send(ctx, 200, { ok: true });
    }
    if (method === "POST" && path === "/config") {
      const body = jsonOf(ctx);
      if (!body) return send(ctx, 400, { error: "JSON object expected" });
      applyConfig(body as StubConfigPatch);
      return send(ctx, 200, state.config);
    }
    const gDelete = /^\/google\/files\/([^/]+)\/delete$/.exec(path);
    if (method === "POST" && gDelete) {
      const removed = state.driveFiles.delete(decodeURIComponent(gDelete[1]));
      return send(ctx, removed ? 200 : 404, { ok: removed });
    }
    const gContent = /^\/google\/files\/([^/]+)\/content$/.exec(path);
    if (method === "GET" && gContent) {
      const f = state.driveFiles.get(decodeURIComponent(gContent[1]));
      if (!f?.content) return send(ctx, 404, { error: "not found" });
      return send(ctx, 200, f.content, { "Content-Type": f.sourceMimeType ?? "application/octet-stream" });
    }
    if (method === "GET" && path === "/yandex/content") {
      const p = normPath(ctx.url.searchParams.get("path"));
      const owner = ctx.url.searchParams.get("owner");
      const r = [...state.yandexResources.values()].find(
        (x) => x.path === p && x.type === "file" && (!owner || x.ownerId === owner),
      );
      if (!r?.content) return send(ctx, 404, { error: "not found" });
      return send(ctx, 200, r.content);
    }
    send(ctx, 404, { error: "unknown stub endpoint" });
  };

  // ---------- маршрутизация ----------

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base || "http://127.0.0.1");
    const log: StubRequestLogEntry = {
      at: new Date().toISOString(),
      provider: null,
      op: null,
      method: req.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      auth: authOf(req)?.scheme ?? null,
      body: null,
      status: 0,
    };
    let body: Buffer;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(413);
      res.end();
      return;
    }
    const ctx: Ctx = { req, res, url, body, log };
    log.body = bodySummary(req, body, null);
    const isControl = url.pathname.startsWith("/__stub/");
    // Журнал не пишет сам себя — иначе e2e видели бы свои же запросы.
    if (!isControl) state.requests.push(log);
    try {
      if (isControl) handleStub(ctx, url.pathname.slice("/__stub".length));
      else if (url.pathname.startsWith("/google/")) handleGoogle(ctx, url.pathname.slice("/google".length));
      else if (url.pathname.startsWith("/yandex/")) handleYandex(ctx, url.pathname.slice("/yandex".length));
      else send(ctx, 404, { error: "unknown prefix" });
    } catch (e) {
      if (!res.headersSent) send(ctx, 500, { error: "stub crashed", message: e instanceof Error ? e.message : String(e) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;

  return {
    url: base,
    googleUrl: `${base}/google`,
    yandexUrl: `${base}/yandex`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
