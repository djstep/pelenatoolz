import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";
import {
  assembleWorkbookFromSheets,
  createEmptyWorkbookSnapshot,
  splitWorkbookToSheets,
  type UniverWorkbookData,
} from "@/features/smeta/lib/workbook-model";
import {
  BUILTIN_INDUSTRY_TEMPLATE_ID,
  createBlankWorkbookSnapshot,
  createIndustryTemplateSnapshot,
} from "@/features/smeta/lib/templates";

const budgetInclude = {
  sheets: {
    include: { data: true },
    orderBy: { sortOrder: "asc" as const },
  },
};

export type BudgetListItem = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type BudgetTemplateListItem = {
  id: string;
  name: string;
  isBuiltin: boolean;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
};

export async function listBudgets(projectId: string): Promise<BudgetListItem[]> {
  const rows = await prisma.budget.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function listBudgetTemplates(
  projectId: string,
): Promise<BudgetTemplateListItem[]> {
  const rows = await prisma.budgetTemplate.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }],
    select: { id: true, name: true, createdAt: true, updatedAt: true },
  });
  return [
    {
      id: BUILTIN_INDUSTRY_TEMPLATE_ID,
      name: "Отраслевой шаблон",
      isBuiltin: true,
      description:
        "Базовый набор статей кинопроизводства «из коробки»",
    },
    ...rows.map((r) => ({
      id: r.id,
      name: r.name,
      isBuiltin: false,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  ];
}

export async function getBudgetForProject(projectId: string, budgetId: string) {
  const row = await prisma.budget.findFirst({
    where: { id: budgetId, projectId },
    include: budgetInclude,
  });
  return row ? toClientBudget(row) : null;
}

export async function getOrCreateBudget(projectId: string, createdById?: string) {
  const existing = await prisma.budget.findFirst({
    where: { projectId },
    include: budgetInclude,
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return toClientBudget(existing);
  }

  return createBudgetFromSnapshot(
    projectId,
    createEmptyWorkbookSnapshot("Смета"),
    createdById,
  );
}

export async function createBlankBudget(
  projectId: string,
  createdById?: string,
  name = "Смета",
) {
  return createBudgetFromSnapshot(
    projectId,
    createBlankWorkbookSnapshot(name),
    createdById,
    name,
  );
}

export async function createBudgetFromTemplate(
  projectId: string,
  templateId: string,
  createdById?: string,
  nameOverride?: string,
) {
  if (templateId === BUILTIN_INDUSTRY_TEMPLATE_ID) {
    const name = nameOverride?.trim() || "Смета (отраслевой шаблон)";
    return createBudgetFromSnapshot(
      projectId,
      createIndustryTemplateSnapshot(name),
      createdById,
      name,
    );
  }

  const tpl = await prisma.budgetTemplate.findFirst({
    where: { id: templateId, projectId },
  });
  if (!tpl) return null;

  const snapshot =
    tpl.snapshot && typeof tpl.snapshot === "object"
      ? (tpl.snapshot as Record<string, unknown>)
      : null;
  if (!snapshot) return null;

  const name = nameOverride?.trim() || tpl.name;
  return createBudgetFromSnapshot(projectId, snapshot, createdById, name);
}

export async function saveBudgetAsTemplate(
  projectId: string,
  budgetId: string,
  name: string,
  createdById?: string,
) {
  const budget = await getBudgetForProject(projectId, budgetId);
  if (!budget) return null;

  const trimmed = name.trim().slice(0, 200);
  if (!trimmed) return null;

  return prisma.budgetTemplate.create({
    data: {
      projectId,
      name: trimmed,
      snapshot: budget.workbook as unknown as Prisma.InputJsonValue,
      createdById: createdById ?? null,
    },
    select: { id: true, name: true, createdAt: true },
  });
}

export async function renameBudgetTemplate(
  projectId: string,
  templateId: string,
  name: string,
) {
  if (templateId === BUILTIN_INDUSTRY_TEMPLATE_ID) return null;
  const trimmed = name.trim().slice(0, 200);
  if (!trimmed) return null;

  const updated = await prisma.budgetTemplate.updateMany({
    where: { id: templateId, projectId },
    data: { name: trimmed },
  });
  if (updated.count === 0) return null;
  return { id: templateId, name: trimmed };
}

export async function deleteBudgetTemplate(
  projectId: string,
  templateId: string,
) {
  if (templateId === BUILTIN_INDUSTRY_TEMPLATE_ID) return false;
  const result = await prisma.budgetTemplate.deleteMany({
    where: { id: templateId, projectId },
  });
  return result.count > 0;
}

/** Create a new Budget (+ sheets) from a Univer snapshot — used by Excel import. */
export async function createBudgetFromSnapshot(
  projectId: string,
  snapshot: Record<string, unknown>,
  createdById?: string,
  nameOverride?: string,
) {
  const split = splitWorkbookToSheets(
    nameOverride
      ? { ...snapshot, name: nameOverride }
      : snapshot,
  );

  const created = await prisma.budget.create({
    data: {
      projectId,
      name: split.name,
      styles: split.styles as Prisma.InputJsonValue,
      createdById: createdById ?? null,
      sheets: {
        create: split.sheets.map((s) => ({
          id: s.id,
          name: s.name,
          sortOrder: s.sortOrder,
          data: {
            create: { data: s.data as Prisma.InputJsonValue },
          },
        })),
      },
    },
    include: budgetInclude,
  });

  return toClientBudget(created);
}

export async function renameBudget(
  projectId: string,
  budgetId: string,
  name: string,
) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const updated = await prisma.budget.updateMany({
    where: { id: budgetId, projectId },
    data: { name: trimmed.slice(0, 200) },
  });
  if (updated.count === 0) return null;
  return getBudgetForProject(projectId, budgetId);
}

function toClientBudget(
  row: {
    id: string;
    projectId: string;
    name: string;
    styles: unknown;
    createdAt: Date;
    updatedAt: Date;
    createdById: string | null;
    sheets: {
      id: string;
      name: string;
      sortOrder: number;
      pinned: boolean;
      data: { data: unknown } | null;
    }[];
  },
) {
  const workbook: UniverWorkbookData = assembleWorkbookFromSheets({
    budgetId: row.id,
    name: row.name,
    styles: row.styles,
    sheets: row.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sortOrder,
      data: s.data?.data ?? null,
    })),
  });

  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById,
    workbook,
    sheetsMeta: row.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      sortOrder: s.sortOrder,
      pinned: s.pinned,
    })),
  };
}

export type BudgetClient = Awaited<ReturnType<typeof getOrCreateBudget>>;

export type SheetMeta = BudgetClient["sheetsMeta"][number];

export async function setBudgetSheetPinned(
  projectId: string,
  budgetId: string,
  sheetId: string,
  pinned: boolean,
) {
  const sheet = await prisma.budgetSheet.findFirst({
    where: { id: sheetId, budgetId, budget: { projectId } },
    select: { id: true },
  });
  if (!sheet) return null;

  await prisma.budgetSheet.update({
    where: { id: sheetId },
    data: { pinned },
  });

  return { sheetId, pinned };
}

/** Persist Univer snapshot as Budget + one JSON row per sheet. */
export async function persistBudgetSnapshot(
  projectId: string,
  budgetId: string,
  snapshot: Record<string, unknown>,
) {
  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, projectId },
    include: { sheets: { select: { id: true, pinned: true } } },
  });
  if (!budget) return null;

  const pinnedById = new Map(budget.sheets.map((s) => [s.id, s.pinned]));
  const split = splitWorkbookToSheets(snapshot);
  const incomingIds = new Set(split.sheets.map((s) => s.id));
  const obsoleteIds = budget.sheets
    .map((s) => s.id)
    .filter((id) => !incomingIds.has(id));

  await prisma.$transaction(async (tx) => {
    if (obsoleteIds.length) {
      await tx.budgetSheet.deleteMany({
        where: { budgetId, id: { in: obsoleteIds } },
      });
    }

    await tx.budget.update({
      where: { id: budgetId },
      data: {
        name: split.name,
        styles: split.styles as Prisma.InputJsonValue,
      },
    });

    for (const sheet of split.sheets) {
      const keepPinned = pinnedById.get(sheet.id) ?? false;
      await tx.budgetSheet.upsert({
        where: { id: sheet.id },
        create: {
          id: sheet.id,
          budgetId,
          name: sheet.name,
          sortOrder: sheet.sortOrder,
          pinned: keepPinned,
          data: {
            create: { data: sheet.data as Prisma.InputJsonValue },
          },
        },
        update: {
          name: sheet.name,
          sortOrder: sheet.sortOrder,
          budgetId,
          data: {
            upsert: {
              create: { data: sheet.data as Prisma.InputJsonValue },
              update: { data: sheet.data as Prisma.InputJsonValue },
            },
          },
        },
      });
    }
  });

  const updated = await prisma.budget.findFirstOrThrow({
    where: { id: budgetId },
    include: budgetInclude,
  });

  return toClientBudget(updated);
}
