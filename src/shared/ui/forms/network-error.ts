export const NO_CONNECTION_ERROR = "Нет связи, данные не сохранены — попробуйте ещё раз";

/** Тексты браузеров: Chrome и Edge, Firefox, Safari, обрыв при чтении ответа. */
const NETWORK_MESSAGES = [
  "failed to fetch",
  "networkerror when attempting to fetch resource",
  "load failed",
  "network error",
];

/**
 * Запрос к серверу не дошёл или ответ оборвался. Ошибка с digest пришла от сервера: это
 * настоящее падение, как и любая другая ошибка кода, — их показывает экран ошибки.
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error) || "digest" in error) return false;
  if (error.message === "Connection closed.") return true;
  if (!(error instanceof TypeError)) return false;
  const message = error.message.toLowerCase();
  return NETWORK_MESSAGES.some((text) => message.includes(text));
}
