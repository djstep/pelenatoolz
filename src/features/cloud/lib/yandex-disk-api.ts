import { yandexEndpoints } from "@/features/cloud/lib/endpoints";
import { CloudApiError, CloudReconnectRequiredError } from "@/features/cloud/lib/errors";

/**
 * Запись на Яндекс Диск (права `cloud_api:disk.app_folder`): только папка приложения,
 * пути вида `app:/PELENA/<Проект>/Вызывные/<файл>.xlsx`. Только сервер: первым аргументом — токен.
 * Адреса — только из `yandexEndpoints()` (вне production их подменяет заглушка).
 */

const PROVIDER = "YANDEX_DISK" as const;

export type YandexResource = {
  path: string;
  name: string;
  type: "dir" | "file";
  publicUrl: string | null;
  size: number | null;
};

type YandexResourceJson = {
  path?: string;
  name?: string;
  type?: string;
  public_url?: string;
  size?: number;
};

type YandexLinkJson = { href?: string; method?: string };

/**
 * Путь в папке приложения из частей: `yandexAppPath("PELENA", "Проект", "Вызывные")` →
 * `app:/PELENA/Проект/Вызывные`. «/» и «\» внутри части заменяются, чтобы название проекта не дробило путь.
 */
export function yandexAppPath(...segments: string[]): string {
  const clean = segments
    .map((s) => s.replace(/[/\\]+/g, "-").trim())
    .map((s) => (s === "." || s === ".." ? "_" : s))
    .filter(Boolean);
  return `app:/${clean.join("/")}`;
}

// ---------- запросы и ошибки ----------

/** Ответ Яндекса с ошибкой → наша ошибка. Тело ответа в текст не попадает. */
async function yandexError(res: Response): Promise<Error> {
  let reason: string | null = null;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string") reason = body.error;
  } catch {
    // не JSON — без причины
  }
  const status = res.status;
  if (status === 401) return new CloudReconnectRequiredError(PROVIDER, `http 401 ${reason ?? ""}`.trim());
  if (status === 403) return new CloudApiError(PROVIDER, 403, "Нет прав на эту папку Яндекс Диска", reason);
  if (status === 404) {
    return new CloudApiError(PROVIDER, 404, "Файл или папка не найдены на Яндекс Диске", "notFound");
  }
  if (status === 507) return new CloudApiError(PROVIDER, 507, "На Яндекс Диске нет места", reason);
  if (status === 413) return new CloudApiError(PROVIDER, 413, "Файл слишком большой для Яндекс Диска", reason);
  if (status === 429) {
    return new CloudApiError(
      PROVIDER,
      429,
      "Яндекс ограничил частоту запросов — повторите позже",
      reason ?? "TooManyRequestsError",
    );
  }
  if (status >= 500) {
    return new CloudApiError(PROVIDER, status, "Яндекс Диск временно недоступен — попробуйте позже", reason);
  }
  return new CloudApiError(PROVIDER, status, `Яндекс Диск отклонил запрос (код ${status})`, reason);
}

function networkError() {
  return new CloudApiError(PROVIDER, 0, "Яндекс Диск недоступен — попробуйте позже", "network");
}

/** Сырой запрос: сетевой сбой → ошибка status 0; разбор кода ответа — у вызывающего. */
async function yandexSend(url: string | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw networkError();
  }
}

function withToken(accessToken: string, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `OAuth ${accessToken}`);
  return { ...init, headers };
}

function resourcesUrl(suffix: string, path: string, extra: Record<string, string> = {}) {
  const url = new URL(`${yandexEndpoints().diskApi}/resources${suffix}`);
  url.searchParams.set("path", path);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return url;
}

async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new CloudApiError(PROVIDER, res.status, "Яндекс Диск вернул непонятный ответ — попробуйте позже", "badResponse");
  }
}

/** `app:/a/b/c` → [`app:/a`, `app:/a/b`, `app:/a/b/c`]. */
function folderChain(path: string): string[] {
  const m = /^(app:|disk:)\/*(.*)$/.exec(path);
  if (!m) throw new Error("Путь Яндекс Диска должен начинаться с app:/ или disk:/");
  const parts = m[2].split("/").filter(Boolean);
  return parts.map((_, i) => `${m[1]}/${parts.slice(0, i + 1).join("/")}`);
}

// ---------- операции ----------

/** Папка и все родители по очереди; «уже есть» (409) — не ошибка. */
export async function ensureYandexFolder(accessToken: string, path: string): Promise<void> {
  for (const step of folderChain(path)) {
    const res = await yandexSend(resourcesUrl("", step), withToken(accessToken, { method: "PUT" }));
    if (res.ok) continue;
    if (res.status === 409) {
      const err = await yandexError(res);
      // 409 бывает и «нет родителя» — тогда это настоящая ошибка (родителей создаём по порядку, так быть не должно).
      if (err instanceof CloudApiError && err.reason === "DiskPathDoesntExistsError") throw err;
      continue;
    }
    throw await yandexError(res);
  }
}

/** Файл или папка; null — нет такого. */
export async function getYandexResource(accessToken: string, path: string): Promise<YandexResource | null> {
  const res = await yandexSend(
    resourcesUrl("", path, { fields: "path,name,type,public_url,size" }),
    withToken(accessToken),
  );
  if (res.status === 404) return null;
  if (!res.ok) throw await yandexError(res);
  const json = await readJson<YandexResourceJson>(res);
  return {
    path: json.path ?? path,
    name: json.name ?? "",
    type: json.type === "dir" ? "dir" : "file",
    publicUrl: json.public_url ?? null,
    size: typeof json.size === "number" ? json.size : null,
  };
}

/**
 * Загрузка в два шага: Яндекс выдаёт адрес загрузки (`href`), содержимое уходит туда —
 * без заголовка авторизации (адрес одноразовый и уже привязан к файлу).
 */
export async function uploadYandexFile(
  accessToken: string,
  path: string,
  content: Buffer,
  opts: { overwrite?: boolean } = {},
): Promise<{ path: string }> {
  const overwrite = opts.overwrite ?? true;
  const linkRes = await yandexSend(
    resourcesUrl("/upload", path, { overwrite: overwrite ? "true" : "false" }),
    withToken(accessToken),
  );
  if (!linkRes.ok) throw await yandexError(linkRes);
  const link = await readJson<YandexLinkJson>(linkRes);
  if (!link.href) {
    throw new CloudApiError(PROVIDER, linkRes.status, "Яндекс Диск вернул непонятный ответ — попробуйте позже", "badResponse");
  }

  const putRes = await yandexSend(link.href, {
    method: (link.method ?? "PUT").toUpperCase(),
    body: new Uint8Array(content),
  });
  if (!putRes.ok) throw await yandexError(putRes);
  return { path };
}

/** Публикация (ссылка «для всех, у кого есть ссылка») → адрес публичной ссылки. */
export async function publishYandexResource(accessToken: string, path: string): Promise<{ publicUrl: string }> {
  const pubRes = await yandexSend(resourcesUrl("/publish", path), withToken(accessToken, { method: "PUT" }));
  if (!pubRes.ok) throw await yandexError(pubRes);

  const res = await yandexSend(resourcesUrl("", path, { fields: "public_url" }), withToken(accessToken));
  if (!res.ok) throw await yandexError(res);
  const json = await readJson<YandexResourceJson>(res);
  if (!json.public_url) {
    throw new CloudApiError(PROVIDER, res.status, "Яндекс Диск не выдал ссылку — попробуйте позже", "noPublicUrl");
  }
  return { publicUrl: json.public_url };
}
