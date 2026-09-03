"use server";

import { requireUser } from "@/features/auth/session";
import { requireProjectAccess } from "@/features/memberships/queries";
import { getKppExportBundle } from "@/features/schedule/lib/kpp-export-data";
import type { KppExportBundle } from "@/features/schedule/lib/kpp-export-data";

export async function getKppExportBundleAction(
  projectId: string,
): Promise<{ error?: string; bundle?: KppExportBundle }> {
  try {
    const user = await requireUser();
    await requireProjectAccess(projectId, user.id!, "schedule:read");
  } catch {
    return { error: "Недостаточно прав" };
  }

  const bundle = await getKppExportBundle(projectId);
  if (!bundle) return { error: "Проект не найден" };
  return { bundle };
}
