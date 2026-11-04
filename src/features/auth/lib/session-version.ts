/**
 * Сессия живёт в браузере и выдана на 14 дней, поэтому погасить её можно только сверкой с базой.
 * При смене и сбросе пароля `User.sessionVersion` растёт, и сессии с прежним номером перестают действовать.
 * В сессиях, выданных до этой доработки, номера нет: для них это 0, иначе выкладка выкинула бы всех.
 */
export function isSessionVersionCurrent(
  tokenVersion: unknown,
  currentVersion: number | null | undefined,
): boolean {
  if (currentVersion == null) return false;
  const version = typeof tokenVersion === "number" ? tokenVersion : 0;
  return version === currentVersion;
}
