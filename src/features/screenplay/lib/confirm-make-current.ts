import type { ConfirmRequest } from "@/shared/ui/confirm/confirm-provider";

/** Подтверждение «Сделать текущей»: общий текст для списка версий и шапки версии. */
export function makeCurrentConfirm(
  version: { title: string | null; versionNumber: number },
  action: ConfirmRequest["action"],
): ConfirmRequest {
  const label = version.title?.trim() || `версию ${version.versionNumber}`;
  return {
    title: `Сделать „${label}“ текущей?`,
    details: [
      "Либретто при этом не изменится.",
      "Чтобы перенести в него сцены из этой версии, откройте её и нажмите «Обновить либретто».",
    ],
    confirmLabel: "Сделать текущей",
    action,
  };
}
