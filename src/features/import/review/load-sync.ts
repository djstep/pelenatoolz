import "server-only";

import { loadImportContext } from "@/features/import/review/load-context";
import type { ScriptReviewData } from "@/features/import/review/types";
import { loadVersionSource } from "@/features/import/write/version-source";
import { typingFromVersionBlocks } from "@/features/import/write/version-typing";
import { versionLabel } from "@/features/screenplay/lib/version-label";

/**
 * Предпросмотр синхронизации версии с либретто: блоки версии как вход нормализации,
 * сопоставление — через шапки этой же версии. Только чтение.
 */
export async function loadSyncReview(
  projectId: string,
  versionId: string,
): Promise<ScriptReviewData | null> {
  const source = await loadVersionSource(projectId, versionId);
  if (!source) return null;
  const context = await loadImportContext(projectId, { referenceVersionId: versionId });
  return {
    fileName: versionLabel(source),
    fileSize: 0,
    fileHash: source.hash,
    typing: typingFromVersionBlocks(source.blocks),
    sync: { versionId, label: versionLabel(source) },
    ...context,
  };
}
