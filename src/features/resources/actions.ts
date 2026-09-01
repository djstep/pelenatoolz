"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

export type ResourceActionState = { error?: string; success?: string };

const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  fillInScenes: z.boolean().optional(),
  perShift: z.boolean().optional(),
  countable: z.boolean().optional(),
  showInKpp: z.boolean().optional(),
});

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(5000).optional(),
  shiftRate: z.coerce.number().min(0).optional(),
  shiftHoursMin: z.coerce.number().int().min(0).max(1440).optional(),
  unpaidOvertimeMin: z.coerce.number().int().min(0).max(600).optional(),
  arrivalOffsetMin: z.coerce.number().int().min(0).max(1440).optional(),
});

function checkbox(formData: FormData, key: string) {
  const v = formData.get(key);
  return v === "on" || v === "true";
}

function revalidateResources(projectId: string, categoryId?: string, itemId?: string) {
  revalidatePath(`/ru/projects/${projectId}/resources`);
  if (categoryId) {
    revalidatePath(`/ru/projects/${projectId}/resources/${categoryId}`);
  }
  if (categoryId && itemId) {
    revalidatePath(
      `/ru/projects/${projectId}/resources/${categoryId}/items/${itemId}`,
    );
  }
  revalidatePath(`/ru/projects/${projectId}/libretto`);
}

export async function createResourceCategoryAction(
  projectId: string,
  _prev: ResourceActionState,
  formData: FormData,
): Promise<ResourceActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    fillInScenes: checkbox(formData, "fillInScenes"),
    perShift: checkbox(formData, "perShift"),
    countable: checkbox(formData, "countable"),
    showInKpp: checkbox(formData, "showInKpp"),
  });
  if (!parsed.success) return { error: "Укажите название категории" };

  const maxOrder = await prisma.resourceCategory.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  await prisma.resourceCategory.create({
    data: {
      projectId,
      name: parsed.data.name,
      sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      fillInScenes: parsed.data.fillInScenes ?? true,
      perShift: parsed.data.perShift ?? false,
      countable: parsed.data.countable ?? false,
      showInKpp: parsed.data.showInKpp ?? true,
    },
  });

  revalidateResources(projectId);
  return { success: "Категория добавлена" };
}

export async function updateResourceCategoryAction(
  projectId: string,
  categoryId: string,
  _prev: ResourceActionState,
  formData: FormData,
): Promise<ResourceActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    fillInScenes: checkbox(formData, "fillInScenes"),
    perShift: checkbox(formData, "perShift"),
    countable: checkbox(formData, "countable"),
    showInKpp: checkbox(formData, "showInKpp"),
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  await prisma.resourceCategory.updateMany({
    where: { id: categoryId, projectId },
    data: {
      name: parsed.data.name,
      fillInScenes: parsed.data.fillInScenes ?? true,
      perShift: parsed.data.perShift ?? false,
      countable: parsed.data.countable ?? false,
      showInKpp: parsed.data.showInKpp ?? true,
    },
  });

  revalidateResources(projectId, categoryId);
  return { success: "Категория сохранена" };
}

export async function deleteResourceCategoryAction(
  projectId: string,
  categoryId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) throw new Error("FORBIDDEN");

  const itemCount = await prisma.resourceItem.count({
    where: { categoryId, category: { projectId } },
  });
  if (itemCount > 0) {
    throw new Error("CATEGORY_HAS_ITEMS");
  }

  await prisma.resourceCategory.deleteMany({ where: { id: categoryId, projectId } });
  revalidateResources(projectId);
}

export async function createResourceItemAction(
  projectId: string,
  categoryId: string,
  _prev: ResourceActionState,
  formData: FormData,
): Promise<ResourceActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const category = await prisma.resourceCategory.findFirst({
    where: { id: categoryId, projectId },
  });
  if (!category) return { error: "Категория не найдена" };

  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    notes: formData.get("notes") || undefined,
    shiftRate: formData.get("shiftRate") || undefined,
    shiftHoursMin: formData.get("shiftHoursMin") || undefined,
    unpaidOvertimeMin: formData.get("unpaidOvertimeMin") || undefined,
    arrivalOffsetMin: formData.get("arrivalOffsetMin") || undefined,
  });
  if (!parsed.success) return { error: "Укажите название элемента" };

  const item = await prisma.resourceItem.create({
    data: { categoryId, ...parsed.data },
  });

  revalidateResources(projectId, categoryId, item.id);
  return { success: "Элемент добавлен" };
}

export async function updateResourceItemAction(
  projectId: string,
  categoryId: string,
  itemId: string,
  _prev: ResourceActionState,
  formData: FormData,
): Promise<ResourceActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    notes: formData.get("notes") || undefined,
    shiftRate: formData.get("shiftRate") || undefined,
    shiftHoursMin: formData.get("shiftHoursMin") || undefined,
    unpaidOvertimeMin: formData.get("unpaidOvertimeMin") || undefined,
    arrivalOffsetMin: formData.get("arrivalOffsetMin") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  await prisma.resourceItem.updateMany({
    where: { id: itemId, categoryId, category: { projectId } },
    data: parsed.data,
  });

  revalidateResources(projectId, categoryId, itemId);
  return { success: "Элемент сохранён" };
}

export async function deleteResourceItemAction(
  projectId: string,
  categoryId: string,
  itemId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) throw new Error("FORBIDDEN");

  const usage = await prisma.sceneResourceItem.count({ where: { itemId } });
  if (usage > 0) throw new Error("ITEM_IN_SCENES");

  await prisma.resourceItem.deleteMany({
    where: { id: itemId, categoryId, category: { projectId } },
  });
  revalidateResources(projectId, categoryId);
}

export async function quickCreateResourceItemAction(
  projectId: string,
  categoryId: string,
  name: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Пустое название" };

  const category = await prisma.resourceCategory.findFirst({
    where: { id: categoryId, projectId },
  });
  if (!category) return { error: "Категория не найдена" };

  const existing = await prisma.resourceItem.findFirst({
    where: { categoryId, name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) return { id: existing.id, name: existing.name };

  const created = await prisma.resourceItem.create({
    data: { categoryId, name: trimmed },
  });
  revalidateResources(projectId, categoryId, created.id);
  return { id: created.id, name: created.name };
}
