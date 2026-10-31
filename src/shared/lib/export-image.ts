import { promises as dnsPromises, type LookupAddress } from "node:dns";
import { readFile, stat } from "node:fs/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import net, { type LookupFunction } from "node:net";
import path from "node:path";

/**
 * Фото для выгрузки в Word: сервер сам получает картинку по адресу из базы или из окна выгрузки.
 * Свои загрузки (`/uploads/<проект>/<имя>`) читаются с диска, внешние адреса скачиваются
 * только на публичные IP (защита от SSRF: localhost, внутренняя сеть, метаданные облака).
 */

/** Ожидание одного фото вместе с редиректами. */
export const EXPORT_IMAGE_TIMEOUT_MS = 5_000;
/** Предел одного фото: больше — фото нет. */
export const EXPORT_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
/**
 * Общий бюджет байт фото на одну выгрузку; исчерпан — остальные без фото.
 * Под ограничения Vercel (ответ 4,5 МБ, таймаут функции). После переезда на VPS — пересмотреть;
 * правильнее сжимать фото через sharp.
 */
export const EXPORT_IMAGES_TOTAL_BYTES = 3 * 1024 * 1024;
/**
 * Общее время на все фото выгрузки; дальше — без фото.
 * Под ограничения Vercel (ответ 4,5 МБ, таймаут функции). После переезда на VPS — пересмотреть;
 * правильнее сжимать фото через sharp.
 */
export const EXPORT_IMAGES_TOTAL_MS = 20_000;
/** Сколько фото скачивается одновременно. */
export const EXPORT_IMAGES_CONCURRENCY = 4;
/** Сколько редиректов проходит одно фото; каждый проверяется заново. */
export const EXPORT_IMAGE_MAX_REDIRECTS = 3;
const ALLOWED_PORTS: readonly number[] = [80, 443];

export const EXPORT_IMAGES_PARTIAL_WARNING =
  "Часть фото не вставлена: превышен размер или время выгрузки";

const BLOCKED_IPV4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
];
const BLOCKED_IPV6: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2002::", 16],
];

// Правило `::ffff:0:0/96` не добавлять: BlockList сверяет IPv4 и с ним, и запрет лёг бы на все IPv4.
// Развёрнутую запись (`0:0:0:0:0:ffff:7f00:1`) BlockList сам сверяет с правилами IPv4.
const BLOCKED = new net.BlockList();
for (const [address, prefix] of BLOCKED_IPV4) BLOCKED.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of BLOCKED_IPV6) BLOCKED.addSubnet(address, prefix, "ipv6");

/** `::ffff:127.0.0.1` и `::ffff:7f00:1` → `127.0.0.1`; остальное без изменений. */
function mappedToIPv4(ip: string): string {
  const lower = ip.toLowerCase();
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return ip;
}

/** Адрес, на который сервер не ходит. Не IP — тоже запрещён. */
export function isBlockedIp(ip: string): boolean {
  const bare = mappedToIPv4(ip.replace(/^\[|\]$/g, "").replace(/%.*$/, ""));
  const family = net.isIP(bare);
  if (family === 4) return BLOCKED.check(bare, "ipv4");
  if (family === 6) return BLOCKED.check(bare, "ipv6");
  return true;
}

export type ResolveHost = (hostname: string) => Promise<LookupAddress[]>;

const resolveHost: ResolveHost = (hostname) =>
  dnsPromises.lookup(hostname, { all: true });

/**
 * `lookup` для сокета: резолвит имя, проверяет каждый адрес и отдаёт сокету уже проверенный —
 * соединение идёт ровно туда, что проверено (против DNS rebinding). Хоть один запрещённый — отказ.
 * Поддерживает оба вызова: обычный (адрес, семейство) и `options.all` (массив) — так зовёт
 * сокет с `autoSelectFamily` (Node 20+).
 */
export function createGuardedLookup(
  resolve: ResolveHost,
  isBlocked: (ip: string) => boolean,
): LookupFunction {
  return (hostname, options, callback) => {
    const family =
      options.family === 4 || options.family === "IPv4"
        ? 4
        : options.family === 6 || options.family === "IPv6"
          ? 6
          : 0;
    resolve(hostname).then(
      (found) => {
        if (found.some((a) => isBlocked(a.address))) {
          callback(new Error(`Запрещённый адрес: ${hostname}`), "", 0);
          return;
        }
        const addresses = family ? found.filter((a) => a.family === family) : found;
        if (addresses.length === 0) {
          callback(new Error(`Нет адреса: ${hostname}`), "", 0);
          return;
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 0),
    );
  };
}

export type ExportImage = { data: Uint8Array; type: "jpg" | "png" | "gif" };

export type ExportImages = {
  /** Фото по исходному адресу; `null` — фото нет. */
  get(url: string | null | undefined): ExportImage | null;
  /** Хоть одно фото пропущено из-за общего бюджета байт или общего времени. */
  partial: boolean;
};

export type ExportImageLimits = {
  photoMs: number;
  maxBytes: number;
  totalBytes: number;
  totalMs: number;
  concurrency: number;
  maxRedirects: number;
};

/** Только для тестов: подмена DNS, проверки IP, портов, папки загрузок и лимитов. */
export type ExportImageDeps = {
  resolveHost: ResolveHost;
  isBlockedIp: (ip: string) => boolean;
  allowedPorts: readonly number[];
  uploadsRoot: string;
  limits?: Partial<ExportImageLimits>;
};

const DEFAULT_LIMITS: ExportImageLimits = {
  photoMs: EXPORT_IMAGE_TIMEOUT_MS,
  maxBytes: EXPORT_IMAGE_MAX_BYTES,
  totalBytes: EXPORT_IMAGES_TOTAL_BYTES,
  totalMs: EXPORT_IMAGES_TOTAL_MS,
  concurrency: EXPORT_IMAGES_CONCURRENCY,
  maxRedirects: EXPORT_IMAGE_MAX_REDIRECTS,
};

/** Фото выгрузки по адресам из базы и окна; `projectId` — из проверенного контекста. */
export function loadExportImages(
  projectId: string,
  urls: readonly (string | null | undefined)[],
): Promise<ExportImages> {
  return loadExportImagesWith(projectId, urls, {
    resolveHost,
    isBlockedIp,
    allowedPorts: ALLOWED_PORTS,
    uploadsRoot: path.join(process.cwd(), "public", "uploads"),
  });
}

class OverBudget extends Error {}

type Run = {
  limits: ExportImageLimits;
  bytesLeft: number;
  /** Бюджет байт исчерпан — новые фото не начинаются. */
  stopped: boolean;
  partial: boolean;
  /** Общее время выгрузки. */
  signal: AbortSignal;
};

/** Учёт байт одного фото в общем бюджете; при неудаче фото они возвращаются. */
type Ticket = { bytes: number };

function reserve(run: Run, ticket: Ticket, bytes: number) {
  if (bytes > run.bytesLeft) {
    run.stopped = true;
    throw new OverBudget();
  }
  run.bytesLeft -= bytes;
  ticket.bytes += bytes;
}

export async function loadExportImagesWith(
  projectId: string,
  urls: readonly (string | null | undefined)[],
  deps: ExportImageDeps,
): Promise<ExportImages> {
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const unique = [
    ...new Set(urls.map((u) => u?.trim()).filter((u): u is string => Boolean(u))),
  ];
  const found = new Map<string, ExportImage>();
  const run: Run = {
    limits,
    bytesLeft: limits.totalBytes,
    stopped: false,
    partial: false,
    signal: AbortSignal.timeout(limits.totalMs),
  };

  let next = 0;
  async function worker() {
    while (next < unique.length) {
      const url = unique[next++];
      if (run.stopped || run.signal.aborted) {
        run.partial = true;
        continue;
      }
      const image = await loadOne(url, projectId, deps, run);
      if (image) found.set(url, image);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limits.concurrency, unique.length) }, worker),
  );

  return {
    get: (url) => (url ? (found.get(url.trim()) ?? null) : null),
    partial: run.partial,
  };
}

async function loadOne(
  url: string,
  projectId: string,
  deps: ExportImageDeps,
  run: Run,
): Promise<ExportImage | null> {
  const ticket: Ticket = { bytes: 0 };
  let image: ExportImage | null = null;
  try {
    const bytes = url.startsWith("/")
      ? await readUpload(url, projectId, deps.uploadsRoot, run, ticket)
      : await download(url, deps, run, ticket);
    image = bytes ? asImage(bytes) : null;
  } catch (err) {
    if (err instanceof OverBudget || run.signal.aborted) run.partial = true;
  }
  if (!image) run.bytesLeft += ticket.bytes;
  return image;
}

/** Тип по первым байтам файла. WebP и прочее Word не показывает — фото нет. */
function asImage(data: Uint8Array): ExportImage | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { data, type: "jpg" };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= png.length && png.every((v, i) => data[i] === v)) {
    return { data, type: "png" };
  }
  const head = Buffer.from(data.subarray(0, 6)).toString("latin1");
  if (head === "GIF87a" || head === "GIF89a") return { data, type: "gif" };
  return null;
}

const UPLOAD_NAME = /^[A-Za-z0-9_-]+\.(jpg|jpeg|png|gif|webp)$/;

/** Своя загрузка текущего проекта — с диска; любой другой путь сайта — фото нет. */
async function readUpload(
  sitePath: string,
  projectId: string,
  uploadsRoot: string,
  run: Run,
  ticket: Ticket,
): Promise<Uint8Array | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) return null;
  const prefix = `/uploads/${projectId}/`;
  if (!sitePath.startsWith(prefix)) return null;
  const name = sitePath.slice(prefix.length);
  if (!UPLOAD_NAME.test(name)) return null;

  const file = path.join(uploadsRoot, projectId, name);
  const info = await stat(file);
  if (!info.isFile() || info.size > run.limits.maxBytes) return null;
  reserve(run, ticket, info.size);
  const data = await readFile(file, { signal: run.signal });
  if (data.length > info.size) reserve(run, ticket, data.length - info.size);
  return new Uint8Array(data);
}

/** Адрес, на который можно идти: http(s), разрешённый порт, без логина, IP-адрес — не запрещённый. */
function checkTarget(raw: string, deps: ExportImageDeps): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!deps.allowedPorts.includes(port)) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // Для IP в адресе сокет не зовёт lookup — проверка здесь.
  if (net.isIP(host) && deps.isBlockedIp(host)) return null;
  return url;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function download(
  raw: string,
  deps: ExportImageDeps,
  run: Run,
  ticket: Ticket,
): Promise<Uint8Array | null> {
  const signal = AbortSignal.any([run.signal, AbortSignal.timeout(run.limits.photoMs)]);
  let current = raw;
  for (let redirects = 0; ; redirects++) {
    const target = checkTarget(current, deps);
    if (!target) return null;
    const res = await request(target, deps, signal);

    if (REDIRECT_STATUSES.has(res.statusCode ?? 0)) {
      res.destroy();
      const location = res.headers.location;
      if (!location || redirects >= run.limits.maxRedirects) return null;
      current = new URL(location, target).toString();
      continue;
    }
    if (res.statusCode !== 200 || !/^image\//i.test(res.headers["content-type"]?.trim() ?? "")) {
      res.destroy();
      return null;
    }
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared)) {
      if (declared > run.limits.maxBytes) {
        res.destroy();
        return null;
      }
      if (declared > run.bytesLeft) {
        res.destroy();
        run.stopped = true;
        throw new OverBudget();
      }
    }
    return readBody(res, run, ticket);
  }
}

function request(
  target: URL,
  deps: ExportImageDeps,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  const client = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: target.protocol,
        host: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: { accept: "image/*" },
        agent: false,
        lookup: createGuardedLookup(deps.resolveHost, deps.isBlockedIp),
        signal,
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

/** Тело ответа с подсчётом байт по ходу: больше предела фото — обрыв, больше бюджета — обрыв и пропуск. */
async function readBody(
  res: IncomingMessage,
  run: Run,
  ticket: Ticket,
): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > run.limits.maxBytes) {
      res.destroy();
      return null;
    }
    reserve(run, ticket, chunk.length);
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
