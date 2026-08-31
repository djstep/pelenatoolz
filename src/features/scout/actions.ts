"use server";

import { ScoutCandidateStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approveScoutCandidate } from "@/features/preproduction/lib/approve-scout";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

export type ScoutActionState = { error?: string; success?: string };

const scoutSchema = z.object({
  locationId: z.string().cuid(),
  title: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional(),
  cost: z.coerce.number().min(0).optional(),
  contactName: z.string().trim().max(100).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(5000).optional(),
  photoUrls: z.string().trim().optional(),
});

function parseMediaUrls(raw: string | undefined) {
  if (!raw?.trim()) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((url) => ({ url }));
}

function revalidateScout(projectId: string, locationId?: string) {
  revalidatePath(`/ru/projects/${projectId}/preproduction/scout`);
  revalidatePath(`/ru/projects/${projectId}/locations`);
  if (locationId) {
    revalidatePath(`/ru/projects/${projectId}/locations/${locationId}`);
  }
}

export async function createScoutCandidateAction(
  projectId: string,
  _prev: ScoutActionState,
  formData: FormData,
): Promise<ScoutActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const parsed = scoutSchema.safeParse({
    locationId: formData.get("locationId"),
    title: formData.get("title"),
    address: formData.get("address") || undefined,
    cost: formData.get("cost") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    notes: formData.get("notes") || undefined,
    photoUrls: formData.get("photoUrls") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  const location = await prisma.location.findFirst({
    where: { id: parsed.data.locationId, projectId },
  });
  if (!location) return { error: "Локация не найдена" };

  await prisma.scoutCandidate.create({
    data: {
      projectId,
      locationId: parsed.data.locationId,
      title: parsed.data.title,
      address: parsed.data.address,
      cost: parsed.data.cost,
      contactName: parsed.data.contactName,
      contactPhone: parsed.data.contactPhone,
      notes: parsed.data.notes,
      photos: parseMediaUrls(parsed.data.photoUrls),
    },
  });

  revalidateScout(projectId);
  return { success: "Кандидат-локация добавлен" };
}

export async function updateScoutCandidateStatusAction(
  projectId: string,
  candidateId: string,
  status: ScoutCandidateStatus,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  if (status === ScoutCandidateStatus.APPROVED) {
    try {
      const result = await approveScoutCandidate(projectId, candidateId);
      revalidateScout(projectId, result.locationId);
      return { success: `«${result.scoutTitle}» утверждена для локации` };
    } catch {
      return { error: "Не удалось утвердить локацию" };
    }
  }

  await prisma.scoutCandidate.updateMany({
    where: { id: candidateId, projectId },
    data: { status, statusChangedAt: new Date() },
  });

  revalidateScout(projectId);
  return { success: "Статус обновлён" };
}

export async function deleteScoutCandidateAction(
  projectId: string,
  candidateId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  await prisma.scoutCandidate.deleteMany({
    where: { id: candidateId, projectId },
  });
  revalidateScout(projectId);
  return { success: "Кандидат удалён" };
}
