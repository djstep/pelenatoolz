/** Подтверждение «Сделать текущей»: общий текст для списка версий и шапки версии. */
export function confirmMakeCurrent(version: {
  title: string | null;
  versionNumber: number;
}) {
  const label = version.title?.trim() || `версию ${version.versionNumber}`;
  return window.confirm(
    `Сделать «${label}» текущей?\n\nЛибретто при этом не изменится. ` +
      "Чтобы перенести в него сцены из этой версии, откройте её и нажмите «Обновить либретто».",
  );
}
