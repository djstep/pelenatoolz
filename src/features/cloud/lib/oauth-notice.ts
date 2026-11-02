import type { CloudProvider } from "@prisma/client";
import type { ReconnectReason } from "@/features/cloud/lib/scopes";

/** Параметры адреса, которые ставит возврат из окна согласия; страница убирает их после показа. */
export const CLOUD_NOTICE_PARAMS = ["cloud_connected", "cloud_error"] as const;

const CONNECTED: Record<string, { provider: CloudProvider; label: string }> = {
  google: { provider: "GOOGLE_DRIVE", label: "Google Диск" },
  yandex: { provider: "YANDEX_DISK", label: "Яндекс Диск" },
};

/**
 * Сообщение после возврата из окна согласия (`?cloud_connected=` / `?cloud_error=` в адресе).
 * «Подключён» — только если рабочее подключение этого диска действительно есть в базе
 * (`connections` — подключения человека на момент показа); иначе — ошибка, а не ложный успех.
 */
export function cloudOAuthNotice(
  params: {
    cloud_connected?: string | string[];
    cloud_error?: string | string[];
  },
  connections: ReadonlyArray<{ provider: CloudProvider; reconnectReason: ReconnectReason | null }>,
): { tone: "success" | "error"; text: string } | null {
  const connected = typeof params.cloud_connected === "string" ? params.cloud_connected : null;
  const error = typeof params.cloud_error === "string" ? params.cloud_error : null;
  const disk = connected ? CONNECTED[connected] : undefined;
  if (disk) {
    const conn = connections.find((c) => c.provider === disk.provider);
    if (conn && !conn.reconnectReason) return { tone: "success", text: `${disk.label} подключён` };
    return {
      tone: "error",
      text: conn
        ? `${disk.label} подключён, но доступ не тот — переподключите`
        : `${disk.label} не подключён: подключение не сохранилось — подключите ещё раз`,
    };
  }
  switch (error) {
    case null:
      return null;
    case "google":
      return { tone: "error", text: "Google Диск не подключён: доступ не выдан в окне Google" };
    case "yandex":
      return { tone: "error", text: "Яндекс Диск не подключён: доступ не выдан в окне Яндекса" };
    case "scope":
      return {
        tone: "error",
        text: "Google Диск не подключён: в окне Google не отмечен доступ к файлам. Подключите ещё раз и оставьте галочку",
      };
    case "scope_yandex":
      return {
        tone: "error",
        text: "Яндекс Диск не подключён: Яндекс не выдал доступ к папке приложения. Проверьте права приложения в Яндексе",
      };
    case "config_google":
      return {
        tone: "error",
        text: "Подключение Google Диска не настроено на сервере (нет ключей приложения Google) — сообщите администратору",
      };
    case "config_yandex":
      return {
        tone: "error",
        text: "Подключение Яндекс Диска не настроено на сервере (нет ключей приложения Яндекса) — сообщите администратору",
      };
    case "forbidden":
      return {
        tone: "error",
        text: "Нет прав на подключение диска проекта: подключает владелец проекта или продюсер",
      };
    case "not_keeper":
      return {
        tone: "error",
        text: "Диск проекта уже подключён: заменить его может хранитель диска или владелец проекта",
      };
    case "unsupported":
      return { tone: "error", text: "Диск проекта подключается только Google" };
    case "state":
      return { tone: "error", text: "Подключение устарело или начато под другим входом — начните заново" };
    default:
      return { tone: "error", text: "Не удалось подключить диск — попробуйте ещё раз" };
  }
}

/**
 * Сообщение на странице настроек после окна согласия для диска проекта (`?cloud_connected=project`).
 * «Подключён» — только если в базе действительно рабочий диск проекта; ошибки — общие тексты.
 */
export function projectDriveOAuthNotice(
  params: {
    cloud_connected?: string | string[];
    cloud_error?: string | string[];
  },
  drive: { status: "ACTIVE" | "DETACHED"; needsReconnect: boolean } | null,
): { tone: "success" | "error"; text: string } | null {
  if (params.cloud_connected === "project") {
    return drive?.status === "ACTIVE" && !drive.needsReconnect
      ? { tone: "success", text: "Диск проекта подключён" }
      : { tone: "error", text: "Диск проекта не подключён: подключение не сохранилось — подключите ещё раз" };
  }
  return cloudOAuthNotice({ cloud_error: params.cloud_error }, []);
}
