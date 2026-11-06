"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  locationFormSchema,
  locationPhotoSchema,
} from "@/features/locations/schemas";
import { formatLocationTitle } from "@/features/locations/lib/format-location";
import {
  canEditLocationScheme,
  checkLocationSchemeSave,
  LOCATION_NOT_FOUND,
  locationSchemeChanges,
  type LocationSchemeData,
} from "@/features/locations/lib/scheme-rules";
import type { LocationScoutSnapshot } from "@/features/preproduction/lib/snapshots";
import { parseScoutSnapshot } from "@/features/preproduction/lib/snapshots";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { impactLines } from "@/shared/lib/plural";
import { changedFrom, clearEmptied, orCurrent } from "@/shared/lib/cleared-fields";
import { pickFinanceFields } from "@/shared/lib/finance-fields";
import { SCOUT_SNAPSHOT_INPUT_FIELDS } from "@/features/locations/lib/location-fields";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation, recordAudit } from "@/shared/audit/with-audit";
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

  const location = await prisma.location.findFirst({
    where: { id: locationId, projectId },
    select: { name: true },
  });
  if (!location) return;
  await prisma.location.deleteMany({ where: { id: locationId, projectId } });
  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.location,
    entityId: locationId,
    action: "DELETE",
    summary: `Удалена локация «${location.name}»`,
  });
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

  try {
    await assertInProject("Location", locationId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) {
      return { error: "Объект не найден" };
    }
    throw error;
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

  const photo = await prisma.locationPhoto.findFirst({
    where: {
      id: photoId,
      locationId,
      location: { projectId },
    },
    select: { id: true },
  });
  if (!photo) throw new Error("Объект не найден");

  await prisma.locationPhoto.deleteMany({
    where: { id: photo.id, locationId, location: { projectId } },
  });
  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.locationPhoto,
    entityId: photo.id,
    action: "DELETE",
    summary: "Удалено фото локации",
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
  // Стоимость площадки — только с фин. правкой объектов, иначе присланное не пишется.
  const input = pickFinanceFields(
    clearEmptied(parsed.data, formData, ["address", "cost", "contactName", "contactPhone", "notes"]),
    SCOUT_SNAPSHOT_INPUT_FIELDS,
    gate.ctx.canFinanceWrite("locations"),
  );

  const current = parseScoutSnapshot(location.scoutSnapshot);
  if (!current) return { error: "Некорректный снимок" };

  const next: LocationScoutSnapshot = {
    ...current,
    address: orCurrent(input.address, current.address),
    cost: orCurrent(input.cost, current.cost),
    contactName: orCurrent(input.contactName, current.contactName),
    contactPhone: orCurrent(input.contactPhone, current.contactPhone),
    notes: orCurrent(input.notes, current.notes),
  };

  await prisma.location.update({
    where: { id: locationId },
    data: {
      scoutSnapshot: next as unknown as Prisma.InputJsonValue,
      address: changedFrom(input.address, current.address) ? input.address : undefined,
      notes: changedFrom(input.notes, current.notes) ? input.notes : undefined,
    },
  });

  revalidateLocations(projectId, locationId);
  return { success: "Данные утверждённой площадки обновлены" };
}

export async function updateLocationFinancialAction(
  projectId: string,
  locationId: string,
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.canFinanceWrite("locations")) {
    return { error: "Нет прав на редактирование финансовых условий локаций" };
  }

  const { parseHhMmToMinutes } = await import("@/shared/i18n/domain-labels");
  const { parseOvertimeFormRows } = await import(
    "@/features/payroll/lib/parse-overtime-form"
  );

  const durationMinutes = z.preprocess((val) => {
    if (val === "" || val == null) return undefined;
    return parseHhMmToMinutes(String(val));
  }, z.number().int().min(0).optional());

  const schema = z.object({
    shiftRate: z.coerce.number().min(0).optional(),
    shiftHoursMin: durationMinutes.pipe(z.number().max(1440).optional()),
    unpaidOvertimeMin: durationMinutes.pipe(z.number().max(600).optional()),
    taxPercent: z.coerce.number().min(0).max(1000).optional(),
    overtimeMode: z
      .enum(["HALF_HOUR", "HOURLY_CUMULATIVE", "HOURLY_FLAT"])
      .optional(),
    unpaidOvertimeMode: z.enum(["FIRST_HOUR", "EACH_HOUR"]).optional(),
  });

  const parsed = schema.safeParse({
    shiftRate: formData.get("shiftRate") || undefined,
    shiftHoursMin: formData.get("shiftHoursMin") || undefined,
    unpaidOvertimeMin: formData.get("unpaidOvertimeMin") || undefined,
    taxPercent: formData.get("taxPercent") || undefined,
    overtimeMode: formData.get("overtimeMode") || undefined,
    unpaidOvertimeMode: formData.get("unpaidOvertimeMode") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте финансовые условия" };

  const existing = await prisma.location.findFirst({
    where: { id: locationId, projectId },
    select: { id: true },
  });
  if (!existing) return { error: "Локация не найдена" };

  const data = clearEmptied(parsed.data, formData, [
    "shiftRate",
    "shiftHoursMin",
    "unpaidOvertimeMin",
    "taxPercent",
  ]);
  const shiftRate = data.shiftRate ?? 0;
  const taxPct = data.taxPercent ?? 0;
  const overtime = parseOvertimeFormRows(formData, shiftRate, taxPct);

  await prisma.$transaction([
    prisma.locationOvertimeRate.deleteMany({ where: { locationId } }),
    prisma.location.update({
      where: { id: locationId },
      data,
    }),
    ...(overtime.length
      ? [
          prisma.locationOvertimeRate.createMany({
            data: overtime.map((r) => ({ ...r, locationId })),
          }),
        ]
      : []),
  ]);

  revalidateLocations(projectId, locationId);
  return { success: "Финансовые условия сохранены" };
}

/** Схема объекта для вызывного: координаты, «Как добраться», «Парковка», «На месте», точки. */
export async function saveLocationSchemeAction(
  projectId: string,
  locationId: string,
  _prev: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const ctx = await requireProjectContext(projectId);
  const checked = await checkLocationSchemeSave(
    {
      canEdit: canEditLocationScheme(ctx),
      inProject: async (id) => {
        try {
          await assertInProject("Location", id, projectId);
          return true;
        } catch (error) {
          if (isNotInProjectError(error)) return false;
          throw error;
        }
      },
    },
    locationId,
    {
      coordinates: formData.get("coordinates"),
      directions: formData.get("directions"),
      parking: formData.get("parking"),
      onSiteNotes: formData.get("onSiteNotes"),
      points: formData.get("points"),
    },
  );
  if ("error" in checked) return { error: checked.error };
  const { data } = checked;

  const location = await prisma.location.findFirst({
    where: { id: checked.locationId, projectId },
    select: {
      name: true,
      sublocation: true,
      latitude: true,
      longitude: true,
      directions: true,
      parking: true,
      onSiteNotes: true,
      points: {
        orderBy: { sortOrder: "asc" },
        select: { number: true, name: true, description: true },
      },
    },
  });
  if (!location) return { error: LOCATION_NOT_FOUND };

  const changes = locationSchemeChanges(
    {
      latitude: location.latitude,
      longitude: location.longitude,
      directions: location.directions,
      parking: location.parking,
      onSiteNotes: location.onSiteNotes,
      points: location.points,
    },
    data,
  );
  if (!changes) return { success: "Схема сохранена" };

  await auditMutation(
    ctx,
    async (next: LocationSchemeData) => {
      // Точки сохраняются списком целиком: на них ничего не ссылается.
      await prisma.$transaction(async (tx) => {
        await tx.location.update({
          where: { id: checked.locationId, projectId },
          data: {
            latitude: next.latitude,
            longitude: next.longitude,
            directions: next.directions,
            parking: next.parking,
            onSiteNotes: next.onSiteNotes,
          },
        });
        await tx.locationPoint.deleteMany({ where: { locationId: checked.locationId } });
        await tx.locationPoint.createMany({
          data: next.points.map((row, index) => ({
            ...row,
            locationId: checked.locationId,
            sortOrder: index,
          })),
        });
      });
    },
    data,
    {
      projectId,
      entityType: AuditEntityType.location,
      entityId: checked.locationId,
      action: "UPDATE",
      summary: `Изменена схема объекта «${formatLocationTitle(location.name, location.sublocation)}»`,
      changes,
    },
  );

  revalidateLocations(projectId, checked.locationId);
  return { success: "Схема сохранена" };
}


/** Что произойдёт при удалении локации — для окна подтверждения. */
export async function getLocationDeleteImpactAction(
  projectId: string,
  locationId: string,
): Promise<string[]> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return [];
  const location = { id: locationId, projectId };
  const [scenes, scout, photos, rates, reportRows] = await Promise.all([
    prisma.sceneLocation.count({ where: { location } }),
    prisma.scoutCandidateLocation.count({ where: { location } }),
    prisma.locationPhoto.count({ where: { location } }),
    prisma.locationOvertimeRate.count({ where: { location } }),
    prisma.productionReportWorkRow.count({ where: { location } }),
  ]);
  return impactLines([
    [scenes, "Локация уберётся из сцен"],
    [scout, "Уберётся из кандидатов скаута"],
    [photos, "Удалятся фото"],
    [rates, "Удалятся ставки переработок"],
    [reportRows, "Отвяжутся строки отчётов смены"],
  ]);
}
