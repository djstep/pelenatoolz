"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { parseHhMmToMinutes } from "@/shared/i18n/domain-labels";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { resourcesRevalidatePaths } from "@/features/resources/lib/paths";
import { parseExtraPaymentFormRows } from "@/features/payroll/lib/parse-extra-payments";
import { parseOvertimeFormRows } from "@/features/payroll/lib/parse-overtime-form";
import { prisma } from "@/shared/db/prisma";
import { countOf } from "@/shared/lib/plural";
import type { Tx } from "@/features/call-sheets/queries";
import { ensureCallSheetSections } from "@/features/call-sheets/sections-db";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import {
  checkCategorySection,
  type CategorySection,
  type CategorySectionDeps,
} from "@/features/resources/lib/category-section";

export type ResourceActionState = { error?: string; success?: string };

/** Ключ раздела вызывного этого проекта; undefined — раздела нет или он чужой. */
function sectionKeyInProject(projectId: string): CategorySectionDeps["sectionKey"] {
  return async (id) => {
    try {
      await assertInProject("CallSheetSection", id, projectId);
    } catch (error) {
      if (isNotInProjectError(error)) return undefined;
      throw error;
    }
    const row = await prisma.callSheetSection.findFirst({
      where: { id, projectId },
      select: { key: true },
    });
    return row ? row.key : undefined;
  };
}

/** id раздела для записи: системного раздела может ещё не быть в базе — создаётся. */
async function sectionIdFor(
  tx: Pick<Tx, "callSheetSection">,
  projectId: string,
  section: CategorySection,
): Promise<string | null> {
  if (section.kind === "none") return null;
  if (section.kind === "id") return section.id;
  await ensureCallSheetSections(tx, projectId);
  const row = await tx.callSheetSection.findFirst({
    where: { projectId, key: section.key },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function sectionLabel(
  tx: Pick<Tx, "callSheetSection">,
  sectionId: string | null,
): Promise<string> {
  if (!sectionId) return "Прочее";
  const row = await tx.callSheetSection.findUnique({
    where: { id: sectionId },
    select: { name: true },
  });
  return row?.name ?? "Прочее";
}

const durationMinutes = z.preprocess((val) => {
  if (val == null || String(val).trim() === "") return undefined;
  return parseHhMmToMinutes(String(val));
}, z.number().int().min(0).optional());

const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  fillInScenes: z.boolean().optional(),
  perShift: z.boolean().optional(),
  countable: z.boolean().optional(),
  showInKpp: z.boolean().optional(),
  tracksMileage: z.boolean().optional(),
});

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(5000).optional(),
  shiftRate: z.coerce.number().min(0).optional(),
  shiftHoursMin: durationMinutes.pipe(z.number().max(1440).optional()),
  unpaidOvertimeMin: durationMinutes.pipe(z.number().max(600).optional()),
  arrivalOffsetMin: durationMinutes.pipe(z.number().max(1440).optional()),
  taxPercent: z.coerce.number().min(0).max(1000).optional(),
  kmRate: z.preprocess((val) => {
    if (val == null || val === "") return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }, z.number().min(0).nullable().optional()),
  overtimeMode: z
    .enum(["HALF_HOUR", "HOURLY_CUMULATIVE", "HOURLY_FLAT"])
    .optional(),
  unpaidOvertimeMode: z.enum(["FIRST_HOUR", "EACH_HOUR"]).optional(),
});

function checkbox(formData: FormData, key: string) {
  const v = formData.get(key);
  return v === "on" || v === "true";
}

function revalidateResources(projectId: string, categoryId?: string, itemId?: string) {
  for (const base of resourcesRevalidatePaths(projectId)) {
    revalidatePath(base);
  }
  if (categoryId) {
    revalidatePath(`/ru/projects/${projectId}/settings/resources/${categoryId}`);
    revalidatePath(`/ru/projects/${projectId}/resources/${categoryId}`);
  }
  if (categoryId && itemId) {
    revalidatePath(
      `/ru/projects/${projectId}/settings/resources/${categoryId}/items/${itemId}`,
    );
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
    tracksMileage: checkbox(formData, "tracksMileage"),
  });
  if (!parsed.success) return { error: "Укажите название категории" };

  // Раздел вызывного по умолчанию (точное название) — только здесь, при создании.
  const section = await checkCategorySection(
    { canEdit: ctx.can("script:write"), sectionKey: sectionKeyInProject(projectId) },
    formData.get("callSheetSection"),
    { name: parsed.data.name, perShift: parsed.data.perShift ?? false, creating: true },
  );
  if ("error" in section) return { error: section.error };

  await auditMutation(
    ctx,
    (data) =>
      prisma.$transaction(async (tx) => {
        const maxOrder = await tx.resourceCategory.aggregate({
          where: { projectId },
          _max: { sortOrder: true },
        });
        const callSheetSectionId = await sectionIdFor(tx, projectId, section.section);
        const created = await tx.resourceCategory.create({
          data: {
            projectId,
            name: data.name,
            sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
            fillInScenes: data.fillInScenes ?? true,
            perShift: data.perShift ?? false,
            countable: data.countable ?? false,
            showInKpp: data.showInKpp ?? true,
            tracksMileage: data.tracksMileage ?? false,
            callSheetSectionId,
          },
        });
        return { ...created, sectionName: await sectionLabel(tx, callSheetSectionId) };
      }),
    parsed.data,
    {
      projectId,
      entityType: AuditEntityType.resourceCategory,
      action: "CREATE",
      entityId: (_, c) => c.id,
      summary: (_, c) => `Создана категория ресурсов «${c.name}»`,
      changes: (_, c) => ({ callSheetSection: c.sectionName }),
    },
  );

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
    tracksMileage: checkbox(formData, "tracksMileage"),
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  const before = await prisma.resourceCategory.findFirst({
    where: { id: categoryId, projectId },
    select: { callSheetSectionId: true },
  });
  if (!before) return { error: "Категория не найдена" };

  // Раздел вызывного меняется только руками: из формы, без подбора по названию.
  const section = await checkCategorySection(
    { canEdit: ctx.can("script:write"), sectionKey: sectionKeyInProject(projectId) },
    formData.get("callSheetSection"),
    { name: parsed.data.name, perShift: parsed.data.perShift ?? false, creating: false },
  );
  if ("error" in section) return { error: section.error };

  await auditMutation(
    ctx,
    (data) =>
      prisma.$transaction(async (tx) => {
        const callSheetSectionId = await sectionIdFor(tx, projectId, section.section);
        await tx.resourceCategory.updateMany({
          where: { id: categoryId, projectId },
          data: {
            name: data.name,
            fillInScenes: data.fillInScenes ?? true,
            perShift: data.perShift ?? false,
            countable: data.countable ?? false,
            showInKpp: data.showInKpp ?? true,
            tracksMileage: data.tracksMileage ?? false,
            callSheetSectionId,
          },
        });
        const sectionChange =
          callSheetSectionId === before.callSheetSectionId
            ? null
            : {
                from: await sectionLabel(tx, before.callSheetSectionId),
                to: await sectionLabel(tx, callSheetSectionId),
              };
        return { ...data, sectionChange };
      }),
    parsed.data,
    {
      projectId,
      entityType: AuditEntityType.resourceCategory,
      action: "UPDATE",
      entityId: categoryId,
      summary: (_, d) => `Обновлена категория «${d.name}»`,
      changes: (_, d) => (d.sectionChange ? { callSheetSection: d.sectionChange } : undefined),
    },
  );

  revalidateResources(projectId, categoryId);
  return { success: "Категория сохранена" };
}

export async function deleteResourceCategoryAction(
  projectId: string,
  categoryId: string,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const itemCount = await prisma.resourceItem.count({
    where: { categoryId, category: { projectId } },
  });
  if (itemCount > 0) {
    return {
      error: `В категории ${countOf(itemCount, ["ресурс", "ресурса", "ресурсов"])} — удалить нельзя`,
    };
  }

  await auditMutation(
    ctx,
    async () => {
      await prisma.resourceCategory.deleteMany({ where: { id: categoryId, projectId } });
    },
    null,
    {
      projectId,
      entityType: AuditEntityType.resourceCategory,
      action: "DELETE",
      entityId: categoryId,
      summary: "Удалена категория ресурсов",
    },
  );
  revalidateResources(projectId);
  return {};
}

function parseItemForm(formData: FormData) {
  const kmRaw = formData.get("kmRate");
  return {
    name: formData.get("name"),
    notes: formData.get("notes") || undefined,
    shiftRate: formData.get("shiftRate") || undefined,
    shiftHoursMin: formData.get("shiftHoursMin") || undefined,
    unpaidOvertimeMin: formData.get("unpaidOvertimeMin") || undefined,
    arrivalOffsetMin: formData.get("arrivalOffsetMin") || undefined,
    taxPercent: formData.get("taxPercent") || undefined,
    kmRate:
      kmRaw == null || String(kmRaw).trim() === "" ? null : kmRaw,
    overtimeMode: formData.get("overtimeMode") || undefined,
    unpaidOvertimeMode: formData.get("unpaidOvertimeMode") || undefined,
  };
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

  const parsed = itemSchema.safeParse(parseItemForm(formData));
  if (!parsed.success) return { error: "Укажите название элемента" };

  const canFin = ctx.canFinanceWrite({ categoryId });
  const {
    shiftRate,
    shiftHoursMin,
    unpaidOvertimeMin,
    taxPercent,
    overtimeMode,
    unpaidOvertimeMode,
    kmRate,
    ...base
  } = parsed.data;

  const overtime = canFin
    ? parseOvertimeFormRows(formData, shiftRate ?? 0, taxPercent ?? 0)
    : [];
  const extras = canFin
    ? parseExtraPaymentFormRows(formData, taxPercent ?? 0)
    : [];

  const item = await auditMutation(
    ctx,
    async () =>
      prisma.resourceItem.create({
        data: {
          categoryId,
          ...base,
          ...(canFin
            ? {
                shiftRate,
                shiftHoursMin,
                unpaidOvertimeMin,
                taxPercent,
                overtimeMode,
                unpaidOvertimeMode,
                kmRate,
                overtimeRates: overtime.length ? { create: overtime } : undefined,
                extraPayments: extras.length ? { create: extras } : undefined,
              }
            : {}),
        },
      }),
    parsed.data,
    {
      projectId,
      entityType: AuditEntityType.resourceItem,
      action: "CREATE",
      entityId: (_, i) => i.id,
      summary: (_, i) => `Добавлен ресурс «${i.name}»`,
    },
  );

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

  const parsed = itemSchema.safeParse(parseItemForm(formData));
  if (!parsed.success) return { error: "Проверьте данные" };

  const existingItem = await prisma.resourceItem.findFirst({
    where: { id: itemId, categoryId, category: { projectId } },
    select: { id: true },
  });
  if (!existingItem) return { error: "Объект не найден" };

  const canFin = ctx.canFinanceWrite({ categoryId });
  const {
    shiftRate,
    shiftHoursMin,
    unpaidOvertimeMin,
    taxPercent,
    overtimeMode,
    unpaidOvertimeMode,
    kmRate,
    ...base
  } = parsed.data;

  await auditMutation(
    ctx,
    async () => {
      if (canFin) {
        const overtime = parseOvertimeFormRows(
          formData,
          shiftRate ?? 0,
          taxPercent ?? 0,
        );
        const extras = parseExtraPaymentFormRows(formData, taxPercent ?? 0);
        await prisma.$transaction([
          prisma.resourceOvertimeRate.deleteMany({ where: { itemId } }),
          prisma.resourceExtraPayment.deleteMany({ where: { itemId } }),
          prisma.resourceItem.updateMany({
            where: { id: itemId, categoryId, category: { projectId } },
            data: {
              ...base,
              shiftRate,
              shiftHoursMin,
              unpaidOvertimeMin,
              taxPercent,
              overtimeMode,
              unpaidOvertimeMode,
              kmRate,
            },
          }),
          ...(overtime.length
            ? [
                prisma.resourceOvertimeRate.createMany({
                  data: overtime.map((r) => ({ ...r, itemId })),
                }),
              ]
            : []),
          ...(extras.length
            ? [
                prisma.resourceExtraPayment.createMany({
                  data: extras.map((r) => ({ ...r, itemId })),
                }),
              ]
            : []),
        ]);
      } else {
        await prisma.resourceItem.updateMany({
          where: { id: itemId, categoryId, category: { projectId } },
          data: base,
        });
      }
      return parsed.data;
    },
    parsed.data,
    {
      projectId,
      entityType: AuditEntityType.resourceItem,
      action: "UPDATE",
      entityId: itemId,
      summary: (_, d) => `Обновлён ресурс «${d.name}»`,
    },
  );

  revalidateResources(projectId, categoryId, itemId);
  return { success: "Элемент сохранён" };
}

export async function deleteResourceItemAction(
  projectId: string,
  categoryId: string,
  itemId: string,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("script:write")) return { error: "Недостаточно прав" };

  const usage = await prisma.sceneResourceItem.count({
    where: { itemId, item: { categoryId, category: { projectId } } },
  });
  if (usage > 0) {
    return {
      error: `Ресурс указан в ${countOf(usage, ["сцене", "сценах", "сценах"])} — удалить нельзя`,
    };
  }

  await auditMutation(
    ctx,
    async () => {
      await prisma.resourceItem.deleteMany({
        where: { id: itemId, categoryId, category: { projectId } },
      });
    },
    null,
    {
      projectId,
      entityType: AuditEntityType.resourceItem,
      action: "DELETE",
      entityId: itemId,
      summary: "Удалён элемент ресурса",
    },
  );
  revalidateResources(projectId, categoryId);
  return {};
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

  const created = await auditMutation(
    ctx,
    async (name) => prisma.resourceItem.create({ data: { categoryId, name } }),
    trimmed,
    {
      projectId,
      entityType: AuditEntityType.resourceItem,
      action: "CREATE",
      entityId: (_, i) => i.id,
      summary: (_, i) => `Быстро добавлен ресурс «${i.name}»`,
    },
  );
  revalidateResources(projectId, categoryId, created.id);
  return { id: created.id, name: created.name };
}
