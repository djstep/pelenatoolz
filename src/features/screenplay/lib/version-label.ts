export function versionLabel(version: {
  versionNumber: number;
  title: string | null;
}) {
  return version.title?.trim()
    ? version.title
    : `Версия ${version.versionNumber}`;
}
