/** Сообщение после возврата из окна согласия (`?cloud_connected=` / `?cloud_error=` в адресе). */
export function cloudOAuthNotice(params: {
  cloud_connected?: string | string[];
  cloud_error?: string | string[];
}): { tone: "success" | "error"; text: string } | null {
  const connected = typeof params.cloud_connected === "string" ? params.cloud_connected : null;
  const error = typeof params.cloud_error === "string" ? params.cloud_error : null;
  if (connected === "google") return { tone: "success", text: "Google Диск подключён" };
  if (connected === "yandex") return { tone: "success", text: "Яндекс Диск подключён" };
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
    case "forbidden":
      return { tone: "error", text: "Нет прав на подключение диска" };
    case "unsupported":
      return { tone: "error", text: "Диск проекта пока не подключается" };
    case "state":
      return { tone: "error", text: "Подключение устарело или начато под другим входом — начните заново" };
    default:
      return { tone: "error", text: "Не удалось подключить диск — попробуйте ещё раз" };
  }
}
