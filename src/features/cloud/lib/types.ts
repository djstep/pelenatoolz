import type { CloudProvider } from "@prisma/client";

export const cloudProviderLabels: Record<CloudProvider, string> = {
  GOOGLE_DRIVE: "Google Диск",
  YANDEX_DISK: "Яндекс Диск",
};

export function formatFileSize(bytes?: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
