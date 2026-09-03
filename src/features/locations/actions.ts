"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  locationFormSchema,
  locationPhotoSchema,
} from "@/features/locations/schemas";
import type { LocationScoutSnapshot } from "@/features/preproduction/lib/snapshots";
import { parseScoutSnapshot } from "@/features/preproduction/lib/snapshots";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { z } from "zod";

export type LocationActionState = { error?: string; success?: string };

function revalidateLocations(projectId: string, locationId?: string) {
  revalidatePath(`/ru/projects/${projectId}/locations`);
  revalidatePath(`/ru/projects/${projectId}/libretto`);
  revalidatePath(`/ru/projects/${projectId}/schedule`);
  if (locationId) {
    revalidatePath(`/ru/projects/${projectId}/locations/${locationId}`);
  }
}

async function assertScriptWrite(projectId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" } as const;
  }
  return { ctx } as const;
}

function parseLocationForm(formData: FormData) {
  return locationFormSchema.safeParse({
    name: formData.get("name"),
    sublocation: formData.get("sublocation") || undefined,
    locationKind: formData.get("locationKind") || undefined,
    hasDecoration: formData.get("hasDecoration") ?? undefined,
    address: formData.get("address") || undefined,
    tags: formData.get("tags") || undefined,
    notes: formData.get("notes") || undefined,
    applyAddressToSiblings: formData.get("applyAddressToSiblings") ?? undefined,
  });
}

export async function createLocationAction(
  projectId: string,
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return gate;

  const parsed = parseLocationForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  const d = parsed.data;
  const location = await prisma.location.create({
    data: {
      projectId,
      name: d.name,
      sublocation: d.sublocation || null,
      locationKind: d.locationKind ?? null,
      hasDecoration: d.hasDecoration ?? false,
      address: d.address || null,
      tags: d.tags || null,
      notes: d.notes || null,
    },
  });

  if (d.applyAddressToSiblings && d.address && d.sublocation) {
    await prisma.location.updateMany({
      where: {
        projectId,
        name: d.name,
        id: { not: location.id },
      },
      data: { address: d.address },
    });
  }

  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.location,
    entityId: location.id,
    action: "CREATE",
    summary: `Создана локация ${d.name}${d.sublocation ? `.${d.sublocation}` : ""}`,
  });

  revalidateLocations(projectId, location.id);
  return { success: "Локация добавлена" };
}

export async function updateLocationAction(
  projectId: string,
  locationId: string,
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return gate;

  const parsed = parseLocationForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  const d = parsed.data;
  await prisma.location.update({
    where: { id: locationId, projectId },
    data: {
      name: d.name,
      sublocation: d.sublocation || null,
      locationKind: d.locationKind ?? null,
      hasDecoration: d.hasDecoration ?? false,
      address: d.address || null,
      tags: d.tags || null,
      notes: d.notes || null,
    },
  });

  if (d.applyAddressToSiblings && d.address) {
    await prisma.location.updateMany({
      where: { projectId, name: d.name, id: { not: locationId } },
      data: { address: d.address },
    });
  }

  revalidateLocations(projectId, locationId);
  return { success: "Локация сохранена" };
}

export async function deleteLocationAction(
  projectId: string,
  locationId: string,
) {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) throw new Error(gate.error);

  await prisma.location.deleteMany({ where: { id: locationId, projectId } });
  revalidateLocations(projectId);
}

export async function addLocationPhotoAction(
  projectId: string,
  locationId: string,
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return gate;

  const parsed = locationPhotoSchema.safeParse({
    url: formData.get("url"),
    caption: formData.get("caption") || undefined,
  });
  if (!parsed.success) {
    return { error: "Укажите корректный URL изображения" };
  }

  const count = await prisma.locationPhoto.count({ where: { locationId } });
  await prisma.locationPhoto.create({
    data: {
      locationId,
      url: parsed.data.url,
      caption: parsed.data.caption ?? null,
      sortOrder: count,
    },
  });

  revalidateLocations(projectId, locationId);
  return { success: "Фото добавлено" };
}

export async function deleteLocationPhotoAction(
  projectId: string,
  locationId: string,
  photoId: string,
) {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) throw new Error(gate.error);

  await prisma.locationPhoto.deleteMany({
    where: { id: photoId, locationId },
  });
  revalidateLocations(projectId, locationId);
}

export async function quickCreateLocationAction(
  projectId: string,
  name: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return { error: gate.error ?? "Недостаточно прав" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Пустое название" };

  const existing = await prisma.location.findFirst({
    where: { projectId, name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) return { id: existing.id, name: existing.name };

  const created = await prisma.location.create({
    data: { projectId, name: trimmed },
  });
  revalidateLocations(projectId);
  return { id: created.id, name: created.name };
}

const requirementSchema = z.object({
  requirementNotes: z.string().trim().max(5000).optional(),
});

const scoutSnapshotSchema = z.object({
  address: z.string().trim().max(500).optional(),
  cost: z.coerce.number().min(0).optional(),
  contactName: z.string().trim().max(100).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(5000).optional(),
});

export async function updateLocationRequirementsAction(
  projectId: string,
  locationId: string,
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return gate;

  const parsed = requirementSchema.safeParse({
    requirementNotes: formData.get("requirementNotes") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  await prisma.location.updateMany({
    where: { id: locationId, projectId },
    data: { requirementNotes: parsed.data.requirementNotes ?? null },
  });

  revalidateLocations(projectId, locationId);
  return { success: "Требования сохранены" };
}

export async function updateLocationScoutSnapshotAction(
  projectId: string,
  locationId: string,
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return gate;

  const location = await prisma.location.findFirst({
    where: { id: locationId, projectId },
  });
  if (!location?.scoutSnapshot) {
    return { error: "Снимок появится после утверждения кандидата скаута" };
  }

  const parsed = scoutSnapshotSchema.safeParse({
    address: formData.get("address") || undefined,
    cost: formData.get("cost") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  const current = parseScoutSnapshot(location.scoutSnapshot);
  if (!current) return { error: "Некорректный снимок" };

  const next: LocationScoutSnapshot = {
    ...current,
    address: parsed.data.address ?? current.address,
    cost: parsed.data.cost ?? current.cost,
    contactName: parsed.data.contactName ?? current.contactName,
    contactPhone: parsed.data.contactPhone ?? current.contactPhone,
    notes: parsed.data.notes ?? current.notes,
  };

  await prisma.location.update({
    where: { id: locationId },
    data: {
      scoutSnapshot: next as unknown as Prisma.InputJsonValue,
      address: next.address ?? undefined,
      notes: next.notes ?? undefined,
    },
  });

  revalidateLocations(projectId, locationId);
  return { success: "Данные утверждённой площадки обновлены" };
}
