"use server";

import { ScoutCandidateStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { approveScoutCandidate } from "@/features/preproduction/lib/approve-scout";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

export type ScoutActionState = { error?: string; success?: string };

const scoutSchema = z.object({
  locationIds: z.array(z.string().cuid()).min(1),
  title: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional(),
  cost: z.coerce.number().min(0).optional(),
  contactName: z.string().trim().max(100).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(5000).optional(),
  photoUrls: z.string().trim().optional(),
  videoUrls: z.string().trim().optional(),
});

function parseMediaUrls(raw: string | undefined) {
  if (!raw?.trim()) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((url) => ({ url }));
}

function parseLocationIds(formData: FormData) {
  return formData.getAll("locationIds").map(String).filter(Boolean);
}

function revalidateScout(projectId: string, candidateId?: string, locationIds?: string[]) {
  revalidatePath(`/ru/projects/${projectId}/preproduction/scout`);
  if (candidateId) {
    revalidatePath(`/ru/projects/${projectId}/preproduction/scout/${candidateId}`);
  }
  revalidatePath(`/ru/projects/${projectId}/locations`);
  for (const locationId of locationIds ?? []) {
    revalidatePath(`/ru/projects/${projectId}/locations/${locationId}`);
  }
}

async function assertLocations(projectId: string, locationIds: string[]) {
  const count = await prisma.location.count({
    where: { projectId, id: { in: locationIds } },
  });
  if (count !== locationIds.length) return false;
  return true;
}

export async function createScoutCandidateAction(
  projectId: string,
  _prev: ScoutActionState,
  formData: FormData,
): Promise<ScoutActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const locationIds = parseLocationIds(formData);
  const parsed = scoutSchema.safeParse({
    locationIds,
    title: formData.get("title"),
    address: formData.get("address") || undefined,
    cost: formData.get("cost") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    notes: formData.get("notes") || undefined,
    photoUrls: formData.get("photoUrls") || undefined,
    videoUrls: formData.get("videoUrls") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  if (!(await assertLocations(projectId, parsed.data.locationIds))) {
    return { error: "Одна или несколько локаций не найдены" };
  }

  await prisma.scoutCandidate.create({
    data: {
      projectId,
      title: parsed.data.title,
      address: parsed.data.address,
      cost: parsed.data.cost,
      contactName: parsed.data.contactName,
      contactPhone: parsed.data.contactPhone,
      notes: parsed.data.notes,
      photos: parseMediaUrls(parsed.data.photoUrls),
      videos: parseMediaUrls(parsed.data.videoUrls),
      locationLinks: {
        create: parsed.data.locationIds.map((locationId) => ({ locationId })),
      },
    },
  });

  revalidateScout(projectId, undefined, parsed.data.locationIds);
  return { success: "Кандидат-локация добавлен" };
}

export async function updateScoutCandidateAction(
  projectId: string,
  candidateId: string,
  _prev: ScoutActionState,
  formData: FormData,
): Promise<ScoutActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.scoutCandidate.findFirst({
    where: { id: candidateId, projectId },
    select: { status: true },
  });
  if (!existing) return { error: "Кандидат не найден" };
  if (existing.status === ScoutCandidateStatus.APPROVED) {
    return { error: "Утверждённого кандидата нельзя редактировать" };
  }

  const locationIds = parseLocationIds(formData);
  const parsed = scoutSchema.safeParse({
    locationIds,
    title: formData.get("title"),
    address: formData.get("address") || undefined,
    cost: formData.get("cost") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    notes: formData.get("notes") || undefined,
    photoUrls: formData.get("photoUrls") || undefined,
    videoUrls: formData.get("videoUrls") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  if (!(await assertLocations(projectId, parsed.data.locationIds))) {
    return { error: "Одна или несколько локаций не найдены" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.scoutCandidateLocation.deleteMany({ where: { scoutCandidateId: candidateId } });
    await tx.scoutCandidate.update({
      where: { id: candidateId },
      data: {
        title: parsed.data.title,
        address: parsed.data.address,
        cost: parsed.data.cost,
        contactName: parsed.data.contactName,
        contactPhone: parsed.data.contactPhone,
        notes: parsed.data.notes,
        photos: parseMediaUrls(parsed.data.photoUrls),
        videos: parseMediaUrls(parsed.data.videoUrls),
        locationLinks: {
          create: parsed.data.locationIds.map((locationId) => ({ locationId })),
        },
      },
    });
  });

  revalidateScout(projectId, candidateId, parsed.data.locationIds);
  return { success: "Кандидат обновлён" };
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
      revalidateScout(projectId, candidateId, result.locationIds);
      const names = result.locationNames.join(", ");
      return { success: `«${result.scoutTitle}» утверждена для: ${names}` };
    } catch (e) {
      if (e instanceof Error && e.message === "SCOUT_NO_LOCATIONS") {
        return { error: "Привяжите хотя бы один игровой объект" };
      }
      return { error: "Не удалось утвердить локацию" };
    }
  }

  await prisma.scoutCandidate.updateMany({
    where: { id: candidateId, projectId },
    data: { status, statusChangedAt: new Date() },
  });

  revalidateScout(projectId, candidateId);
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
  revalidateScout(projectId, candidateId);
  return { success: "Кандидат удалён" };
}
