"use server";

import { ElementType, SceneResourceCategory, type ProjectType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { refreshAllSluglines, syncSluglineFromScene } from "@/features/screenplay/lib/sync";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { manualRenumberSchema } from "@/features/locations/schemas";
import {
  createSceneSchema,
} from "@/features/script/schemas";
import { prisma } from "@/shared/db/prisma";
import { syncShootDaysForScene } from "@/features/schedule/lib/sync-shoot-day-resources";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { formatSceneNumber } from "@/features/script/lib/libretto-display";
import {
  applySceneNumberChanges,
  planAutoRenumber,
  planManualRenumber,
  sceneNumbersAccessRefusal,
} from "@/features/script/lib/scene-numbers";
import { scenesDeleteRefusal } from "@/features/script/lib/scene-delete";
import { sceneLinkOf, sceneLocationIdsAfterCard } from "@/features/script/lib/scene-locations";
import { impactLines } from "@/shared/lib/plural";

export type ActionState = { error?: string; success?: string; keepOpen?: boolean };

type TransactionCallback = Extract<
  Parameters<typeof prisma.$transaction>[0],
  (client: never) => Promise<unknown>
>;
type Tx = TransactionCallback extends (client: infer T) => Promise<unknown> ? T : never;

function revalidateScript(projectId: string, sceneId?: string) {
  revalidatePath(`/ru/projects/${projectId}/libretto`);
  if (sceneId) {
    revalidatePath(`/ru/projects/${projectId}/libretto/${sceneId}`);
  }
  revalidatePath(`/ru/projects/${projectId}/script`);
  revalidatePath(`/ru/projects/${projectId}/screenplay`);
  revalidatePath(`/ru/projects/${projectId}`);
  revalidatePath(`/ru/projects/${projectId}/schedule`);
  revalidatePath(`/ru/projects/${projectId}/call-sheets`);
  revalidatePath(`/ru/projects/${projectId}/reports`);
  revalidatePath(`/ru/projects/${projectId}/characters`);
}

/**
 * Выбор карточки сцены: объект — строка без родителя, подобъекты — его подобъекты.
 * Id уже проверены на проект (`assertInProject`). Ошибка — текстом, иначе null.
 */
async function checkSceneChoice(projectId: string, objectId: string, subIds: readonly string[]) {
  const rows = await prisma.location.findMany({
    where: { projectId, id: { in: [objectId, ...subIds] } },
    select: { id: true, parentId: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (byId.get(objectId)?.parentId !== null) return "Выберите объект, а не подобъект";
  if (subIds.some((id) => byId.get(id)?.parentId !== objectId)) {
    return "Подобъект не из выбранного объекта";
  }
  return null;
}

function parseSceneForm(formData: FormData) {
  return createSceneSchema.safeParse({
    episodeNumber: formData.get("episodeNumber") || undefined,
    number: formData.get("number"),
    postfix: formData.get("postfix") || undefined,
    title: formData.get("title") || undefined,
    summary: formData.get("summary") || undefined,
    description: formData.get("description") || undefined,
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
    subLocationIds: formData.getAll("subLocationIds").filter(Boolean),
    prevObjectId: formData.get("prevObjectId") || undefined,
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

function parseResourceItemLinks(formData: FormData) {
  const links: Array<{ itemId: string; quantity: number }> = [];
  const seen = new Set<string>();

  for (const [key, value] of formData.entries()) {
    const match = /^cri_item_([a-zA-Z0-9]+)_(\d+)$/.exec(key);
    if (!match) continue;
    const itemId = String(value).trim();
    if (!itemId) continue;
    const categoryId = match[1];
    const index = match[2];
    const quantity = Number(formData.get(`cri_qty_${categoryId}_${index}`)) || 1;
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    links.push({ itemId, quantity });
  }

  return links;
}

async function saveSceneResourceItems(
  projectId: string,
  sceneId: string,
  links: Array<{ itemId: string; quantity: number }>,
) {
  await prisma.sceneResourceItem.deleteMany({ where: { sceneId } });
  if (links.length === 0) return;

  const valid = await prisma.resourceItem.findMany({
    where: {
      id: { in: links.map((l) => l.itemId) },
      category: { projectId, fillInScenes: true },
    },
    select: { id: true },
  });
  const validIds = new Set(valid.map((v) => v.id));
  const filtered = links.filter((l) => validIds.has(l.itemId));
  if (filtered.length === 0) return;

  await prisma.sceneResourceItem.createMany({
    data: filtered.map((l) => ({
      sceneId,
      itemId: l.itemId,
      quantity: l.quantity,
    })),
  });
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
  const resourceItemLinks = parseResourceItemLinks(formData);

  try {
    await assertInProject("Location", [parsed.data.locationId, ...(parsed.data.subLocationIds ?? [])], projectId);
    if (parsed.data.characterIds?.length) {
      await assertInProject("Character", parsed.data.characterIds, projectId);
    }
    if (parsed.data.elementIds?.length) {
      await assertInProject("Element", parsed.data.elementIds, projectId);
    }
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Объект не найден" };
    throw error;
  }

  const choiceError = await checkSceneChoice(projectId, parsed.data.locationId, parsed.data.subLocationIds ?? []);
  if (choiceError) return { error: choiceError };

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
        locations: {
          create: sceneLocationIdsAfterCard({
            current: [],
            prevObjectId: null,
            objectId: parsed.data.locationId,
            subIds: parsed.data.subLocationIds ?? [],
          }).map((locationId) => ({ locationId })),
        },
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

    await saveSceneResourceItems(projectId, scene.id, resourceItemLinks);
    await syncShootDaysForScene(scene.id);

    await recordAudit(ctx, {
      projectId,
      entityType: AuditEntityType.scene,
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
    select: {
      id: true,
      status: true,
      locations: {
        select: { locationId: true, location: { select: { id: true, parent: { select: { id: true } } } } },
      },
    },
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
  const resourceItemLinks = parseResourceItemLinks(formData);

  try {
    await assertInProject("Location", [parsed.data.locationId, ...(parsed.data.subLocationIds ?? [])], projectId);
    if (parsed.data.characterIds?.length) {
      await assertInProject("Character", parsed.data.characterIds, projectId);
    }
    if (parsed.data.elementIds?.length) {
      await assertInProject("Element", parsed.data.elementIds, projectId);
    }
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Объект не найден" };
    throw error;
  }

  const tagElementIds = await resolveTagElements(projectId, formData);
  const allElementIds = [
    ...new Set([...(parsed.data.elementIds ?? []), ...tagElementIds]),
  ];
  const statusChanged = parsed.data.status && parsed.data.status !== existing.status;
  const choiceError = await checkSceneChoice(projectId, parsed.data.locationId, parsed.data.subLocationIds ?? []);
  if (choiceError) return { error: choiceError };
  const locationIds = sceneLocationIdsAfterCard({
    current: existing.locations.map(sceneLinkOf),
    prevObjectId: parsed.data.prevObjectId ?? null,
    objectId: parsed.data.locationId,
    subIds: parsed.data.subLocationIds ?? [],
  });

  try {
    await prisma.$transaction([
      prisma.sceneLocation.deleteMany({ where: { sceneId } }),
      prisma.sceneCharacter.deleteMany({ where: { sceneId } }),
      prisma.sceneElement.deleteMany({ where: { sceneId } }),
      prisma.sceneResource.deleteMany({ where: { sceneId } }),
      prisma.sceneResourceItem.deleteMany({ where: { sceneId } }),
      prisma.scene.update({
        where: { id: sceneId, projectId },
        data: {
          episodeNumber: parsed.data.episodeNumber ?? 0,
          number: parsed.data.number,
          postfix: parsed.data.postfix ?? "",
          title: parsed.data.title ?? null,
          summary: parsed.data.summary ?? null,
          description: parsed.data.description ?? null,
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
          locations: { create: locationIds.map((locationId) => ({ locationId })) },
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
    await saveSceneResourceItems(projectId, sceneId, resourceItemLinks);
    await syncShootDaysForScene(sceneId);
  } catch {
    return { error: "Сцена с таким номером уже существует" };
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.scene,
    entityId: sceneId,
    action: "UPDATE",
    summary: `Обновлена сцена ${parsed.data.number}${parsed.data.postfix ?? ""}`,
  });

  await syncSluglineFromScene(projectId, sceneId).catch(() => {});

  revalidateScript(projectId, sceneId);
  return { success: "Сцена сохранена" };
}

async function allocateDuplicateNumber(
  projectId: string,
  episodeNumber: number,
  baseNumber: string,
  basePostfix: string,
) {
  const siblings = await prisma.scene.findMany({
    where: { projectId, episodeNumber },
    select: { number: true, postfix: true },
  });
  const taken = new Set(siblings.map((s) => `${s.number}\0${s.postfix}`));
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const startIdx = basePostfix
    ? letters.indexOf(basePostfix.toUpperCase()) + 1
    : 0;
  for (let i = Math.max(0, startIdx); i < letters.length; i++) {
    const postfix = letters[i]!;
    if (!taken.has(`${baseNumber}\0${postfix}`)) {
      return { number: baseNumber, postfix };
    }
  }
  const n = Number.parseInt(baseNumber, 10);
  if (!Number.isNaN(n)) {
    for (let next = n + 1; next < n + 1000; next++) {
      if (!taken.has(`${String(next)}\0`)) {
        return { number: String(next), postfix: "" };
      }
    }
  }
  let suffix = 2;
  while (taken.has(`${baseNumber}\0${suffix}`)) suffix += 1;
  return { number: baseNumber, postfix: String(suffix) };
}

export async function duplicateSceneAction(
  projectId: string,
  sceneId: string,
): Promise<{ error?: string; newSceneId?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }

  const source = await prisma.scene.findFirst({
    where: { id: sceneId, projectId },
    include: {
      locations: true,
      characters: true,
      elements: true,
      resources: true,
      resourceItems: true,
    },
  });
  if (!source) return { error: "Сцена не найдена" };

  const nextNumber = await allocateDuplicateNumber(
    projectId,
    source.episodeNumber,
    source.number,
    source.postfix,
  );

  const maxOrder = await prisma.scene.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  try {
    const created = await prisma.scene.create({
      data: {
        projectId,
        episodeNumber: source.episodeNumber,
        number: nextNumber.number,
        postfix: nextNumber.postfix,
        title: source.title,
        summary: source.summary,
        description: source.description,
        scriptContent: source.scriptContent,
        scriptDay: source.scriptDay,
        objectType: source.objectType,
        sceneKind: source.sceneKind,
        shootingUnit: source.shootingUnit,
        montageMap: source.montageMap,
        pageCount: source.pageCount,
        planSeconds: source.planSeconds,
        factSeconds: source.factSeconds,
        preEditSeconds: source.preEditSeconds,
        editSeconds: source.editSeconds,
        filmFootagePlan: source.filmFootagePlan,
        filmFootageFact: source.filmFootageFact,
        intExt: source.intExt,
        dayNight: source.dayNight,
        status: source.status,
        statusDate: source.statusDate,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
        locations: source.locations.length
          ? {
              create: source.locations.map((l) => ({
                locationId: l.locationId,
              })),
            }
          : undefined,
        characters: source.characters.length
          ? {
              create: source.characters.map((c) => ({
                characterId: c.characterId,
              })),
            }
          : undefined,
        elements: source.elements.length
          ? {
              create: source.elements.map((e) => ({
                elementId: e.elementId,
              })),
            }
          : undefined,
        resources: source.resources.length
          ? {
              create: source.resources.map((r) => ({
                category: r.category,
                name: r.name,
                quantity: r.quantity,
                unitPrice: r.unitPrice,
              })),
            }
          : undefined,
        resourceItems: source.resourceItems.length
          ? {
              create: source.resourceItems.map((r) => ({
                itemId: r.itemId,
                quantity: r.quantity,
              })),
            }
          : undefined,
      },
    });

    await syncShootDaysForScene(created.id);

    await recordAudit(ctx, {
      projectId,
      entityType: AuditEntityType.scene,
      entityId: created.id,
      action: "CREATE",
      summary: `Дубликат сцены ${source.number}${source.postfix || ""} → ${created.number}${created.postfix || ""}`,
    });

    revalidateScript(projectId, created.id);
    return { newSceneId: created.id };
  } catch {
    return { error: "Не удалось создать копию сцены" };
  }
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

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.scene,
    entityId: projectId,
    action: "UPDATE",
    summary: `Групповая смена статуса (${sceneIds.length} сц.) → ${status}`,
  });

  revalidateScript(projectId);
}

export async function bulkDeleteScenesAction(
  projectId: string,
  sceneIds: string[],
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }
  if (!Array.isArray(sceneIds) || sceneIds.some((id) => typeof id !== "string")) {
    return { error: "Некорректные данные" };
  }
  if (sceneIds.length === 0) return {};

  // Та же проверка, что в окне, — повторно, под блокировкой строк сцен: сцену нельзя
  // поставить в день или записать по ней факт, пока идёт удаление.
  const refusal = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM "Scene"
      WHERE "projectId" = ${projectId} AND "id" = ANY(${sceneIds}::text[])
      FOR UPDATE`;
    const lines = await scenesDeleteRefusalLines(tx, projectId, ctx.project.type, sceneIds);
    if (lines.length > 0) return lines.join(". ");
    await tx.scene.deleteMany({
      where: { projectId, id: { in: sceneIds } },
    });
    return null;
  });
  if (refusal) return { error: refusal };

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.scene,
    entityId: projectId,
    action: "DELETE",
    summary: `Групповое удаление ${sceneIds.length} сцен`,
  });

  revalidateScript(projectId);
  return {};
}

/** Сцены проекта для перенумерации — под блокировкой строки проекта (как импорт). */
async function lockSceneNumbers(tx: Tx, projectId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
  const scenes = await tx.scene.findMany({
    where: { projectId },
    orderBy: [{ episodeNumber: "asc" }, { sortOrder: "asc" }, { number: "asc" }],
    select: {
      id: true,
      episodeNumber: true,
      number: true,
      postfix: true,
      sortOrder: true,
      cutAt: true,
    },
  });
  return scenes.map(({ cutAt, ...s }) => ({ ...s, cut: cutAt !== null }));
}

/** Авто-перенумерация (кнопки в интерфейсе нет). Номера вырезанных сцен не меняются и пропускаются. */
export async function renumberScenesAction(projectId: string): Promise<ActionState> {
  const ctx = await requireProjectContext(projectId);
  const refusal = sceneNumbersAccessRefusal(ctx.can);
  if (refusal) return { error: refusal };

  let changed: number;
  try {
    changed = await prisma.$transaction(async (tx) => {
      const scenes = await lockSceneNumbers(tx, projectId);
      const changes = planAutoRenumber(scenes);
      await applySceneNumberChanges(tx, projectId, changes, scenes);
      return changes.length;
    });
  } catch {
    return { error: "Конфликт номеров — попробуйте ещё раз" };
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.scene,
    entityId: projectId,
    action: "UPDATE",
    summary: `Перенумерация: изменено ${changed} сцен, номера вырезанных не менялись`,
  });

  await refreshAllSluglines(projectId).catch(() => {});

  revalidateScript(projectId);
  return { success: "Нумерация обновлена" };
}

/**
 * Почему выбранные сцены нельзя удалить (пусто — можно): сцена стоит в дне КПП, есть строка
 * отчёта смены или попытка съёмки. Каскад стёр бы их вместе со сценой. Слот дня — не в счёт.
 */
async function scenesDeleteRefusalLines(
  db: Pick<Tx, "scene" | "shootDayScene" | "productionReportSceneFact" | "sceneShootAttempt">,
  projectId: string,
  projectType: ProjectType,
  sceneIds: string[],
): Promise<string[]> {
  const scene = { id: { in: sceneIds }, projectId };
  const [scenes, dayLinks, facts, attempts] = await Promise.all([
    db.scene.findMany({
      where: scene,
      orderBy: [{ episodeNumber: "asc" }, { sortOrder: "asc" }, { number: "asc" }],
      select: { id: true, number: true, postfix: true, episodeNumber: true, cutAt: true },
    }),
    db.shootDayScene.findMany({ where: { scene }, select: { sceneId: true } }),
    db.productionReportSceneFact.findMany({
      where: { scene },
      select: { sceneId: true, report: { select: { shootDayId: true } } },
    }),
    db.sceneShootAttempt.findMany({ where: { scene }, select: { sceneId: true, shootDayId: true } }),
  ]);
  const reportDays = (id: string) =>
    new Set([
      ...facts.filter((f) => f.sceneId === id).map((f) => f.report.shootDayId),
      ...attempts.filter((a) => a.sceneId === id).map((a) => a.shootDayId),
    ]);
  return scenesDeleteRefusal(
    scenes.map((s) => ({
      label: formatSceneNumber(s, projectType),
      cut: s.cutAt !== null,
      shootDays: dayLinks.filter((l) => l.sceneId === s.id).length,
      reportDays: reportDays(s.id),
    })),
  );
}

/** Можно ли удалить сцены — для окна подтверждения, до нажатия. Строки отказа или пусто. */
export async function getScenesDeleteImpactAction(
  projectId: string,
  sceneIds: string[],
): Promise<string[]> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write") || sceneIds.length === 0) return [];
  return scenesDeleteRefusalLines(prisma, projectId, ctx.project.type, sceneIds);
}

/** Где используется сцена — для окна «Вырезать сцену?». Только чтение. */
export async function getSceneCutImpactAction(
  projectId: string,
  sceneId: string,
): Promise<string[]> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return [];
  const scene = { id: sceneId, projectId };
  const [dayLinks, reportRows, attempts] = await Promise.all([
    prisma.shootDayScene.findMany({
      where: { scene },
      select: { shootDay: { select: { dayNumber: true } } },
      orderBy: { shootDay: { dayNumber: "asc" } },
    }),
    prisma.productionReportSceneFact.count({ where: { scene } }),
    prisma.sceneShootAttempt.count({ where: { scene } }),
  ]);
  const lines: string[] = [];
  if (dayLinks.length > 0) {
    const days = dayLinks.map((link) => `№ ${link.shootDay.dayNumber}`).join(", ");
    lines.push(`Стоит в днях КПП: ${days} — останется там с пометкой «вырезана»`);
  }
  lines.push(
    ...impactLines([
      [reportRows, "Строки отчётов смены (не меняются)"],
      [attempts, "Попытки съёмки (не меняются)"],
    ]),
  );
  lines.push("В новые дни КПП сцену будет не добавить. Вернуть можно в любой момент");
  return lines;
}

/** Вырезать сцену (`cut`) или вернуть (`restore`). Сцена и её связи не удаляются. */
export async function setSceneCutAction(
  projectId: string,
  sceneId: string,
  mode: "cut" | "restore",
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) {
    return { error: "Недостаточно прав" };
  }
  if (mode !== "cut" && mode !== "restore") return { error: "Некорректные данные" };

  const scene = await prisma.scene.findFirst({
    where: { id: sceneId, projectId },
    select: { id: true, number: true, postfix: true, episodeNumber: true, cutAt: true },
  });
  if (!scene) return { error: "Сцена не найдена" };

  const cut = mode === "cut";
  if (cut === (scene.cutAt !== null)) return {};

  await prisma.scene.update({
    where: { id: scene.id },
    data: { cutAt: cut ? new Date() : null },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.scene,
    entityId: scene.id,
    action: "UPDATE",
    summary: `Сцена ${formatSceneNumber(scene, ctx.project.type)} ${cut ? "вырезана" : "возвращена"}`,
  });

  revalidateScript(projectId, scene.id);
  return {};
}

export async function manualRenumberScenesAction(
  projectId: string,
  rowsJson: string,
): Promise<ActionState> {
  const ctx = await requireProjectContext(projectId);
  const refusal = sceneNumbersAccessRefusal(ctx.can);
  if (refusal) return { error: refusal };

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
  const input = parsed.data.rows.map((row) => ({ ...row, postfix: row.postfix ?? "" }));

  try {
    await assertInProject("Scene", input.map((row) => row.id), projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Сцена не найдена" };
    throw error;
  }

  let planError: string | null;
  try {
    planError = await prisma.$transaction(async (tx) => {
      const scenes = await lockSceneNumbers(tx, projectId);
      const plan = planManualRenumber(scenes, input, ctx.project.type);
      if ("error" in plan) return plan.error;
      await applySceneNumberChanges(tx, projectId, plan.changes, scenes);
      return null;
    });
  } catch {
    return { error: "Конфликт номеров — проверьте уникальность" };
  }
  if (planError) return { error: planError };

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.scene,
    entityId: projectId,
    action: "UPDATE",
    summary: `Ручная перенумерация (${parsed.data.rows.length} сцен)`,
  });

  revalidateScript(projectId);
  return { success: "Нумерация обновлена" };
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
