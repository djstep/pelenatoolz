"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  locationFormSchema,
  locationPhotoSchema,
} from "@/features/locations/schemas";
import {
  compareLocations,
  formatLocationTitle,
} from "@/features/locations/lib/format-location";
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
import {
  LOCATION_PARENT_SELECT,
  SCOUT_SNAPSHOT_INPUT_FIELDS,
} from "@/features/locations/lib/location-fields";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation, recordAudit, type AuditContext } from "@/shared/audit/with-audit";
import {
  ensurePlace,
  findOrCreateObject,
  findOrCreateSub,
  nextSubOrder,
  type CreatedLocation,
} from "@/features/locations/lib/location-tree-write";
import {
  applyLocationMerge,
  MERGE_REFUSALS,
  planLocationMerge,
} from "@/features/locations/lib/location-merge";
import { cleanSpaces } from "@/features/import/normalize/text";
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

const HAS_SUBOBJECTS =
  "У объекта есть подобъекты — сначала удалите их или перенесите в другой объект";

async function auditCreated(
  ctx: AuditContext,
  projectId: string,
  created: CreatedLocation[],
  reason: string,
) {
  for (const object of created) {
    await recordAudit(ctx, {
      projectId,
      entityType: AuditEntityType.location,
      entityId: object.id,
      action: "CREATE",
      summary: `Создана локация ${object.title} (${reason})`,
    });
  }
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
  const sub = d.sublocation?.trim() || null;
  const createdObjects: CreatedLocation[] = [];
  const location = await prisma.$transaction(async (tx) => {
    // «Подлокация» заполнена — подобъект объекта с этим названием (нет такого — создаётся).
    const parent = sub ? await findOrCreateObject(tx, projectId, d.name, null, createdObjects) : null;
    const created = await tx.location.create({
      data: {
        projectId,
        name: sub ?? d.name,
        parentId: parent?.id ?? null,
        sortOrder: parent ? await nextSubOrder(tx, projectId, parent.id) : 0,
        locationKind: d.locationKind ?? null,
        hasDecoration: d.hasDecoration ?? false,
        address: d.address || null,
        tags: d.tags || null,
        notes: d.notes || null,
      },
      select: { id: true },
    });
    if (parent && d.applyAddressToSiblings && d.address) {
      await tx.location.updateMany({
        where: {
          projectId,
          OR: [{ id: parent.id }, { parentId: parent.id }],
          id: { not: created.id },
        },
        data: { address: d.address },
      });
    }
    return created;
  });

  await auditCreated(gate.ctx, projectId, createdObjects, "для подобъекта");
  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.location,
    entityId: location.id,
    action: "CREATE",
    summary: `Создана локация ${sub ? `${d.name}.${sub}` : d.name}`,
  });

  revalidateLocations(projectId, location.id);
  return { success: "Объект добавлен" };
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
  const sub = d.sublocation?.trim() || null;
  const current = await prisma.location.findFirst({
    where: { id: locationId, projectId },
    select: {
      name: true,
      sublocation: true,
      parentId: true,
      parent: LOCATION_PARENT_SELECT,
      address: true,
      _count: { select: { children: true } },
    },
  });
  if (!current) return { error: LOCATION_NOT_FOUND };
  // Объект с подобъектами сам подобъектом стать не может: вложенность — один уровень.
  if (sub && current._count.children > 0) {
    return { error: "У объекта есть подобъекты — подлокацию ему задать нельзя" };
  }

  const createdObjects: CreatedLocation[] = [];
  const siblings = await prisma.$transaction(async (tx) => {
    // Подлокация заполнена — строка становится подобъектом объекта «Название» (нет — создаётся);
    // пусто — строка объект, его подобъекты остаются при нём.
    const parent = sub
      ? await findOrCreateObject(tx, projectId, d.name, locationId, createdObjects)
      : null;
    const parentId = parent?.id ?? null;
    await tx.location.update({
      where: { id: locationId, projectId },
      data: {
        name: sub ?? d.name,
        parentId,
        ...(parentId !== current.parentId
          ? { sortOrder: parentId ? await nextSubOrder(tx, projectId, parentId) : 0 }
          : {}),
        locationKind: d.locationKind ?? null,
        hasDecoration: d.hasDecoration ?? false,
        address: d.address || null,
        tags: d.tags || null,
        notes: d.notes || null,
      },
    });

    if (d.applyAddressToSiblings && d.address) {
      // Соседи — объект и все его подобъекты.
      const groupId = parentId ?? locationId;
      const result = await tx.location.updateMany({
        where: {
          projectId,
          OR: [{ id: groupId }, { parentId: groupId }],
          id: { not: locationId },
        },
        data: { address: d.address },
      });
      return result.count;
    }
    return 0;
  });

  const before = formatLocationTitle(current);
  const after = sub ? `${cleanSpaces(d.name)}.${sub}` : d.name;
  const notes = [
    before !== after ? `«${before}» → «${after}»` : null,
    (current.address ?? "") !== (d.address ?? "") ? "адрес" : null,
    siblings > 0 ? `адрес соседям: ${siblings}` : null,
  ].filter(Boolean);
  await auditCreated(gate.ctx, projectId, createdObjects, "для подобъекта");
  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.location,
    entityId: locationId,
    action: "UPDATE",
    summary: `Изменена локация «${after}»${notes.length ? ` (${notes.join("; ")})` : ""}`,
  });

  revalidateLocations(projectId, locationId);
  return { success: "Сохранено" };
}

const moveDirectionSchema = z.enum(["up", "down"]);

/**
 * Подобъект на одну позицию выше или ниже внутри своего объекта. Порядок всех подобъектов
 * объекта переписывается подряд (1, 2, 3…): одинаковые номера после старых правок исчезают.
 * Отказ — текстом.
 */
export async function moveSubLocationAction(
  projectId: string,
  locationId: string,
  direction: "up" | "down",
): Promise<string | undefined> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return gate.error;
  const dir = moveDirectionSchema.safeParse(direction);
  if (!dir.success) return "Не тот порядок";

  const moved = await prisma.$transaction(async (tx) => {
    const location = await tx.location.findFirst({
      where: { id: locationId, projectId },
      select: { parentId: true },
    });
    if (!location?.parentId) return null;
    // Одна перестановка в объекте за раз: два одновременных нажатия не перепутают порядок.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`location-order:${location.parentId}`}))`;
    const siblings = await tx.location.findMany({
      where: { projectId, parentId: location.parentId },
      select: { id: true, name: true, sublocation: true, sortOrder: true, parent: LOCATION_PARENT_SELECT },
    });
    siblings.sort(compareLocations);
    const index = siblings.findIndex((s) => s.id === locationId);
    const target = dir.data === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= siblings.length) return null;
    [siblings[index], siblings[target]] = [siblings[target]!, siblings[index]!];
    for (const [i, sibling] of siblings.entries()) {
      if (sibling.sortOrder !== i + 1) {
        await tx.location.update({ where: { id: sibling.id }, data: { sortOrder: i + 1 } });
      }
    }
    return siblings[target]!;
  });
  if (!moved) return;

  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.location,
    entityId: locationId,
    action: "UPDATE",
    summary: `Подобъект «${formatLocationTitle(moved)}» перемещён ${dir.data === "up" ? "выше" : "ниже"}`,
  });
  revalidateLocations(projectId);
}

const mergeIdsSchema = z.object({ sourceId: z.string().min(1).max(64), targetId: z.string().min(1).max(64) });

async function mergeGate(projectId: string, sourceId: string, targetId: string) {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return { error: gate.error ?? "Недостаточно прав" } as const;
  const ids = mergeIdsSchema.safeParse({ sourceId, targetId });
  if (!ids.success) return { error: LOCATION_NOT_FOUND } as const;
  try {
    await assertInProject("Location", [ids.data.sourceId, ids.data.targetId], projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: LOCATION_NOT_FOUND } as const;
    throw error;
  }
  return { ctx: gate.ctx, ...ids.data } as const;
}

/** Что будет при объединении «sourceId» → «targetId»: строки для окна или отказ. */
export async function getLocationMergeImpactAction(
  projectId: string,
  sourceId: string,
  targetId: string,
): Promise<{ lines: string[] } | { error: string }> {
  const gate = await mergeGate(projectId, sourceId, targetId);
  if ("error" in gate) return { error: gate.error ?? LOCATION_NOT_FOUND };
  const plan = await planLocationMerge(
    prisma,
    projectId,
    gate.sourceId,
    gate.targetId,
    gate.ctx.canFinanceWrite("locations"),
  );
  if ("refusal" in plan) return { error: MERGE_REFUSALS[plan.refusal] };
  const { counts } = plan;
  return {
    lines: [
      `«${formatLocationTitle(plan.source)}» исчезнет, его связи перейдут к «${formatLocationTitle(plan.target)}»`,
      ...impactLines([
        [counts.scenes, "Сцен с привязкой"],
        [counts.subsMoved, "Подобъектов перейдёт"],
        [counts.subsMerged, "Одноимённых подобъектов сольётся"],
        [counts.reportRows, "Строк отчётов смены перейдёт"],
        [counts.ratesDropped, "Ставок переработки объединяемого не перейдёт (у оставшегося свои)"],
      ]),
      "Поля оставшегося не меняются; пустые заполнятся из объединяемого",
    ],
  };
}

/** Объединить «sourceId» с «targetId»: первый исчезает, все связи — у второго. Отказ — текстом. */
export async function mergeLocationsAction(
  projectId: string,
  sourceId: string,
  targetId: string,
): Promise<string | undefined> {
  const gate = await mergeGate(projectId, sourceId, targetId);
  if ("error" in gate) return gate.error;
  const canWriteFinance = gate.ctx.canFinanceWrite("locations");

  const result = await prisma.$transaction(
    async (tx) => {
      // Одно объединение в проекте за раз: план и запись видят одни и те же данные.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`location-merge:${projectId}`}))`;
      const plan = await planLocationMerge(tx, projectId, gate.sourceId, gate.targetId, canWriteFinance);
      if ("refusal" in plan) return { refusal: MERGE_REFUSALS[plan.refusal] } as const;
      const summary = await applyLocationMerge(tx, plan, canWriteFinance);
      return { summary, counts: plan.counts } as const;
    },
    { timeout: 30_000 },
  );
  if ("refusal" in result) return result.refusal;

  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.location,
    entityId: gate.targetId,
    action: "UPDATE",
    summary: `${result.summary} (сцен: ${result.counts.scenes}, подобъектов перешло: ${result.counts.subsMoved}, слилось: ${result.counts.subsMerged})`,
  });
  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.location,
    entityId: gate.sourceId,
    action: "DELETE",
    summary: `${result.summary}: объединяемый удалён`,
  });
  revalidateLocations(projectId, gate.targetId);
}

/** Отказ (текст для окна подтверждения) — у объекта есть подобъекты. */
export async function deleteLocationAction(
  projectId: string,
  locationId: string,
): Promise<string | undefined> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) throw new Error(gate.error);

  const location = await prisma.location.findFirst({
    where: { id: locationId, projectId },
    select: {
      name: true,
      sublocation: true,
      parent: LOCATION_PARENT_SELECT,
      _count: { select: { children: true } },
    },
  });
  if (!location) return;
  if (location._count.children > 0) return HAS_SUBOBJECTS;
  try {
    await prisma.location.deleteMany({ where: { id: locationId, projectId } });
  } catch (error) {
    // Подобъект добавили между проверкой и удалением — база не даёт удалить объект.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return HAS_SUBOBJECTS;
    }
    throw error;
  }
  await recordAudit(gate.ctx, {
    projectId,
    entityType: AuditEntityType.location,
    entityId: locationId,
    action: "DELETE",
    summary: `Удалена локация «${formatLocationTitle(location)}»`,
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

/** Объект по названию (карточка сцены): есть — тот же, нет — создаётся. */
export async function quickCreateLocationAction(
  projectId: string,
  name: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return { error: gate.error ?? "Недостаточно прав" };

  const trimmed = cleanSpaces(name);
  if (!trimmed) return { error: "Пустое название" };

  const created: CreatedLocation[] = [];
  const object = await prisma.$transaction((tx) =>
    findOrCreateObject(tx, projectId, trimmed, null, created),
  );
  if (created.length > 0) {
    await auditCreated(gate.ctx, projectId, created, "быстрое создание");
    revalidateLocations(projectId);
  }
  return object;
}

/**
 * Место из шапки сценария («ДОМ. ВАННАЯ / КОРИДОР»): по правилу шапки — объект и подобъекты,
 * как у импорта. Нет — создаются. Ответ — первый объект (подсказки места в редакторе).
 */
export async function quickCreatePlaceAction(
  projectId: string,
  place: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return { error: gate.error ?? "Недостаточно прав" };

  const created: CreatedLocation[] = [];
  const first = await prisma.$transaction((tx) => ensurePlace(tx, projectId, place, created));
  if (!first) return { error: "Пустое название" };
  if (created.length > 0) {
    await auditCreated(gate.ctx, projectId, created, "из шапки сценария");
    revalidateLocations(projectId);
  }
  return first;
}

/** Подобъект объекта по названию (карточка сцены): есть — тот же, нет — создаётся. */
export async function quickCreateSubLocationAction(
  projectId: string,
  objectId: string,
  name: string,
): Promise<{ id: string; name: string; parentId: string } | { error: string }> {
  const gate = await assertScriptWrite(projectId);
  if ("error" in gate) return { error: gate.error ?? "Недостаточно прав" };

  const trimmed = cleanSpaces(name);
  if (!trimmed) return { error: "Пустое название" };
  try {
    await assertInProject("Location", objectId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: LOCATION_NOT_FOUND };
    throw error;
  }

  const created: CreatedLocation[] = [];
  const sub = await prisma.$transaction(async (tx) => {
    const object = await tx.location.findFirst({
      where: { id: objectId, projectId, parentId: null },
      select: { id: true, name: true },
    });
    if (!object) return null;
    return findOrCreateSub(tx, projectId, object, trimmed, created);
  });
  if (!sub) return { error: "Сначала выберите объект" };
  if (created.length > 0) {
    await auditCreated(gate.ctx, projectId, created, "из карточки сцены");
    revalidateLocations(projectId);
  }
  return { id: sub.id, name: sub.name, parentId: objectId };
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
  if (!existing) return { error: "Объект не найден" };

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
      parent: LOCATION_PARENT_SELECT,
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
      summary: `Изменена схема объекта «${formatLocationTitle(location)}»`,
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
  const [children, scenes, scout, photos, rates, reportRows] = await Promise.all([
    prisma.location.count({ where: { projectId, parentId: locationId } }),
    prisma.sceneLocation.count({ where: { location } }),
    prisma.scoutCandidateLocation.count({ where: { location } }),
    prisma.locationPhoto.count({ where: { location } }),
    prisma.locationOvertimeRate.count({ where: { location } }),
    prisma.productionReportWorkRow.count({ where: { location } }),
  ]);
  return impactLines([
    [children, "Подобъекты (пока они есть, объект не удалится)"],
    [scenes, "Уберётся из сцен"],
    [scout, "Уберётся из кандидатов скаута"],
    [photos, "Удалятся фото"],
    [rates, "Удалятся ставки переработок"],
    [reportRows, "Отвяжутся строки отчётов смены"],
  ]);
}
