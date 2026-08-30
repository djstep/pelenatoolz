"use server";

import { ElementType, SceneResourceCategory } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { refreshAllSluglines, syncSluglineFromScene } from "@/features/screenplay/lib/sync";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { manualRenumberSchema } from "@/features/locations/schemas";
import {
  createCharacterSchema,
  createElementSchema,
  createSceneSchema,
} from "@/features/script/schemas";
import { prisma } from "@/shared/db/prisma";
import { writeAuditLog } from "@/shared/audit/log";

export type ActionState = { error?: string; success?: string; keepOpen?: boolean };

function revalidateScript(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/libretto`);
  revalidatePath(`/ru/projects/${projectId}/script`);
  revalidatePath(`/ru/projects/${projectId}/screenplay`);
  revalidatePath(`/ru/projects/${projectId}`);
  revalidatePath(`/ru/projects/${projectId}/schedule`);
  revalidatePath(`/ru/projects/${projectId}/call-sheets`);
  revalidatePath(`/ru/projects/${projectId}/reports`);
}

function parseSceneForm(formData: FormData) {
  return createSceneSchema.safeParse({
    episodeNumber: formData.get("episodeNumber") || undefined,
    number: formData.get("number"),
    postfix: formData.get("postfix") || undefined,
    title: formData.get("title") || undefined,
    summary: formData.get("summary") || undefined,
    description: formData.get("description") || undefined,
    scriptContent: formData.get("scriptContent") || undefined,
    scriptDay: formData.get("scriptDay") || undefined,
    objectType: formData.get("objectType") || undefined,
    sceneKind: formData.get("sceneKind") || undefined,
    shootingUnit: formData.get("shootingUnit") || undefined,
    montageMap: formData.get("montageMap") || undefined,
    pageCount: formData.get("pageCount") || undefined,
    planSeconds: formData.get("planSeconds") || undefined,
    factSeconds: formData.get("factSeconds") || undefined,
    preEditSeconds: formData.get("preEditSeconds") || undefined,
    editSeconds: formData.get("editSeconds") || undefined,
    filmFootagePlan: formData.get("filmFootagePlan") || undefined,
    filmFootageFact: formData.get("filmFootageFact") || undefined,
    intExt: formData.get("intExt") || undefined,
    dayNight: formData.get("dayNight") || undefined,
    status: formData.get("status") || undefined,
    locationId: formData.get("locationId") || undefined,
    characterIds: formData.getAll("characterIds").filter(Boolean),
    elementIds: formData.getAll("elementIds").filter(Boolean),
    createAnother: formData.get("createAnother") ?? undefined,
  });
}

function parseResourceRows(formData: FormData) {
  const categories = Object.values(SceneResourceCategory);
  const rows: Array<{
    category: SceneResourceCategory;
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }> = [];

  for (const category of categories) {
    for (let i = 0; i < 50; i++) {
      const name = String(formData.get(`res_name_${category}_${i}`) ?? "").trim();
      if (!name) continue;
      const quantity = Number(formData.get(`res_qty_${category}_${i}`)) || 1;
      const unitPrice = Number(formData.get(`res_price_${category}_${i}`)) || 0;
      rows.push({
        category,
        name,
        quantity,
        unitPrice,
        total: quantity * unitPrice,
      });
    }
  }
  return rows;
}

const TAG_TO_ELEMENT: Record<string, ElementType> = {
  tag_makeup: ElementType.MAKEUP,
  tag_costume: ElementType.COSTUME,
  tag_prop: ElementType.PROP,
  tag_vehicle: ElementType.VEHICLE,
};

async function resolveTagElements(projectId: string, formData: FormData) {
  const elementIds: string[] = [];
  for (const [field, type] of Object.entries(TAG_TO_ELEMENT)) {
    const names = formData.getAll(field).map(String).filter(Boolean);
    for (const name of names) {
      const existing = await prisma.element.findFirst({
        where: { projectId, name: { equals: name, mode: "insensitive" } },
      });
      if (existing) {
        elementIds.push(existing.id);
        continue;
      }
      const created = await prisma.element.create({
        data: { projectId, name, type },
      });
      elementIds.push(created.id);
    }
  }
  return elementIds;
}

export async function createSceneAction(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const parsed = parseSceneForm(formData);

  if (!parsed.success) {
    return { error: "Проверьте данные сцены" };
  }

  if (!parsed.data.locationId) {
    return { error: "Выберите объект" };
  }

  const maxOrder = await prisma.scene.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  const resources = parseResourceRows(formData);
  const tagElementIds = await resolveTagElements(projectId, formData);
  const allElementIds = [
    ...new Set([...(parsed.data.elementIds ?? []), ...tagElementIds]),
  ];

  try {
    const scene = await prisma.scene.create({
      data: {
        projectId,
        episodeNumber: parsed.data.episodeNumber ?? 0,
        number: parsed.data.number,
        postfix: parsed.data.postfix ?? "",
        title: parsed.data.title,
        summary: parsed.data.summary,
        description: parsed.data.description,
        scriptContent: parsed.data.scriptContent,
        scriptDay: parsed.data.scriptDay,
        objectType: parsed.data.objectType,
        sceneKind: parsed.data.sceneKind,
        shootingUnit: parsed.data.shootingUnit,
        montageMap: parsed.data.montageMap,
        pageCount: parsed.data.pageCount,
        planSeconds: parsed.data.planSeconds,
        factSeconds: parsed.data.factSeconds,
        preEditSeconds: parsed.data.preEditSeconds,
        editSeconds: parsed.data.editSeconds,
        filmFootagePlan: parsed.data.filmFootagePlan,
        filmFootageFact: parsed.data.filmFootageFact,
        intExt: parsed.data.intExt,
        dayNight: parsed.data.dayNight,
        status: parsed.data.status,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
        locations: { create: [{ locationId: parsed.data.locationId }] },
        characters: parsed.data.characterIds?.length
          ? {
              create: parsed.data.characterIds.map((characterId) => ({
                characterId,
              })),
            }
          : undefined,
        elements: allElementIds.length
          ? {
              create: allElementIds.map((elementId) => ({ elementId })),
            }
          : undefined,
        resources: resources.length
          ? {
              create: resources,
            }
          : undefined,
      },
    });

    await writeAuditLog({
      projectId,
      userId: ctx.user.id!,
      entityType: "scene",
      entityId: scene.id,
      action: "CREATE",
      summary: `Создана сцена ${scene.number}${scene.postfix ? scene.postfix : ""}`,
    });
  } catch {
    return { error: "Сцена с таким номером уже существует" };
  }

  revalidateScript(projectId);
  return {
    success: "Сцена добавлена",
    keepOpen: parsed.data.createAnother,
  };
}

export async function updateSceneAction(
  projectId: string,
  sceneId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const existing = await prisma.scene.findFirst({
    where: { id: sceneId, projectId },
    select: { id: true, status: true },
  });
  if (!existing) {
    return { error: "Сцена не найдена" };
  }

  const parsed = parseSceneForm(formData);
  if (!parsed.success) {
    return { error: "Проверьте данные сцены" };
  }
  if (!parsed.data.locationId) {
    return { error: "Выберите объект" };
  }

  const resources = parseResourceRows(formData);
  const tagElementIds = await resolveTagElements(projectId, formData);
  const allElementIds = [
    ...new Set([...(parsed.data.elementIds ?? []), ...tagElementIds]),
  ];
  const statusChanged = parsed.data.status && parsed.data.status !== existing.status;

  try {
    await prisma.$transaction([
      prisma.sceneLocation.deleteMany({ where: { sceneId } }),
      prisma.sceneCharacter.deleteMany({ where: { sceneId } }),
      prisma.sceneElement.deleteMany({ where: { sceneId } }),
      prisma.sceneResource.deleteMany({ where: { sceneId } }),
      prisma.scene.update({
        where: { id: sceneId },
        data: {
          episodeNumber: parsed.data.episodeNumber ?? 0,
          number: parsed.data.number,
          postfix: parsed.data.postfix ?? "",
          title: parsed.data.title ?? null,
          summary: parsed.data.summary ?? null,
          description: parsed.data.description ?? null,
          ...(formData.has("scriptContent")
            ? { scriptContent: parsed.data.scriptContent ?? null }
            : {}),
          scriptDay: parsed.data.scriptDay ?? null,
          objectType: parsed.data.objectType ?? null,
          sceneKind: parsed.data.sceneKind,
          shootingUnit: parsed.data.shootingUnit ?? null,
          montageMap: parsed.data.montageMap ?? null,
          pageCount: parsed.data.pageCount ?? null,
          planSeconds: parsed.data.planSeconds ?? null,
          factSeconds: parsed.data.factSeconds ?? null,
          preEditSeconds: parsed.data.preEditSeconds ?? null,
          editSeconds: parsed.data.editSeconds ?? null,
          filmFootagePlan: parsed.data.filmFootagePlan ?? null,
          filmFootageFact: parsed.data.filmFootageFact ?? null,
          intExt: parsed.data.intExt ?? null,
          dayNight: parsed.data.dayNight ?? null,
          status: parsed.data.status,
          statusDate: statusChanged ? new Date() : undefined,
          locations: { create: [{ locationId: parsed.data.locationId }] },
          characters: parsed.data.characterIds?.length
            ? {
                create: parsed.data.characterIds.map((characterId) => ({
                  characterId,
                })),
              }
            : undefined,
          elements: allElementIds.length
            ? {
                create: allElementIds.map((elementId) => ({ elementId })),
              }
            : undefined,
          resources: resources.length
            ? {
                create: resources,
              }
            : undefined,
        },
      }),
    ]);
  } catch {
    return { error: "Сцена с таким номером уже существует" };
  }

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "scene",
    entityId: sceneId,
    action: "UPDATE",
    summary: `Обновлена сцена ${parsed.data.number}${parsed.data.postfix ?? ""}`,
  });

  await syncSluglineFromScene(sceneId).catch(() => {});

  revalidateScript(projectId);
  return { success: "Сцена сохранена" };
}

export async function bulkUpdateSceneStatusAction(
  projectId: string,
  sceneIds: string[],
  status: import("@prisma/client").SceneStatus,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    throw new Error("FORBIDDEN");
  }
  if (sceneIds.length === 0) return;

  await prisma.scene.updateMany({
    where: { projectId, id: { in: sceneIds } },
    data: { status, statusDate: new Date() },
  });

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "scene",
    entityId: projectId,
    action: "UPDATE",
    summary: `Групповая смена статуса (${sceneIds.length} сц.) → ${status}`,
  });

  revalidateScript(projectId);
}

export async function bulkDeleteScenesAction(
  projectId: string,
  sceneIds: string[],
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    throw new Error("FORBIDDEN");
  }
  if (sceneIds.length === 0) return;

  await prisma.scene.deleteMany({
    where: { projectId, id: { in: sceneIds } },
  });

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "scene",
    entityId: projectId,
    action: "DELETE",
    summary: `Групповое удаление ${sceneIds.length} сцен`,
  });

  revalidateScript(projectId);
}

export async function renumberScenesAction(projectId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    throw new Error("FORBIDDEN");
  }

  const scenes = await prisma.scene.findMany({
    where: { projectId },
    orderBy: [{ episodeNumber: "asc" }, { sortOrder: "asc" }, { number: "asc" }],
    select: { id: true, episodeNumber: true },
  });

  const counters = new Map<number, number>();
  await prisma.$transaction(
    scenes.map((scene) => {
      const next = (counters.get(scene.episodeNumber) ?? 0) + 1;
      counters.set(scene.episodeNumber, next);
      return prisma.scene.update({
        where: { id: scene.id },
        data: {
          number: String(next),
          postfix: "",
          sortOrder: next,
        },
      });
    }),
  );

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "scene",
    entityId: projectId,
    action: "UPDATE",
    summary: `Перенумерация ${scenes.length} сцен`,
  });

  await refreshAllSluglines(projectId).catch(() => {});

  revalidateScript(projectId);
}

export async function deleteSceneAction(projectId: string, sceneId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    throw new Error("FORBIDDEN");
  }

  await prisma.scene.deleteMany({ where: { id: sceneId, projectId } });

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "scene",
    entityId: sceneId,
    action: "DELETE",
  });

  revalidateScript(projectId);
}

export async function manualRenumberScenesAction(
  projectId: string,
  rowsJson: string,
): Promise<ActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  let rows: unknown;
  try {
    rows = JSON.parse(rowsJson);
  } catch {
    return { error: "Некорректные данные" };
  }

  const parsed = manualRenumberSchema.safeParse({ rows });
  if (!parsed.success) {
    return { error: "Проверьте номера сцен" };
  }

  try {
    await prisma.$transaction(
      parsed.data.rows.map((row) =>
        prisma.scene.update({
          where: { id: row.id, projectId },
          data: {
            episodeNumber: row.episodeNumber,
            number: row.number,
            postfix: row.postfix ?? "",
          },
        }),
      ),
    );
  } catch {
    return { error: "Конфликт номеров — проверьте уникальность" };
  }

  await writeAuditLog({
    projectId,
    userId: ctx.user.id!,
    entityType: "scene",
    entityId: projectId,
    action: "UPDATE",
    summary: `Ручная перенумерация (${parsed.data.rows.length} сцен)`,
  });

  revalidateScript(projectId);
  return { success: "Нумерация обновлена" };
}

export async function createCharacterAction(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const parsed = createCharacterSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });

  if (!parsed.success) {
    return { error: "Укажите имя персонажа" };
  }

  await prisma.character.create({ data: { projectId, ...parsed.data } });
  revalidateScript(projectId);
  return { success: "Персонаж добавлен" };
}

export async function createElementAction(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const parsed = createElementSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { error: "Укажите название" };
  }

  await prisma.element.create({ data: { projectId, ...parsed.data } });
  revalidateScript(projectId);
  return { success: "Добавлено" };
}

export async function quickCreateCharacterAction(
  projectId: string,
  name: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const trimmed = name.trim();
  if (!trimmed) return { error: "Пустое имя" };

  const existing = await prisma.character.findFirst({
    where: { projectId, name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) return { id: existing.id, name: existing.name };

  const created = await prisma.character.create({
    data: { projectId, name: trimmed },
  });
  revalidateScript(projectId);
  return { id: created.id, name: created.name };
}
