"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  csvTextToUniverWorkbook,
  excelBufferToUniverWorkbook,
} from "@/features/smeta/lib/import-workbook";
import {
  createBudgetFromSnapshot,
  persistBudgetSnapshot,
  renameBudget,
  setBudgetSheetPinned,
} from "@/features/smeta/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

function revalidateSmeta(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/smeta`);
  revalidatePath(`/ru/projects/${projectId}/budget`);
}

export async function saveBudgetWorkbookAction(
  projectId: string,
  budgetId: string,
  payload: unknown,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("budget:write")) return { error: "Недостаточно прав" };

  const schema = z.object({
    data: z.record(z.string(), z.unknown()),
  });
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { error: "Некорректные данные книги" };

  const saved = await persistBudgetSnapshot(
    projectId,
    budgetId,
    parsed.data.data,
  );
  if (!saved) return { error: "Смета не найдена" };

  return {
    success: "Сохранено",
    updatedAt: saved.updatedAt,
  };
}

export async function renameBudgetAction(
  projectId: string,
  budgetId: string,
  payload: unknown,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("budget:write")) return { error: "Недостаточно прав" };

  const schema = z.object({
    name: z.string().trim().min(1).max(200),
  });
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { error: "Укажите название" };

  const saved = await renameBudget(projectId, budgetId, parsed.data.name);
  if (!saved) return { error: "Смета не найдена" };

  revalidateSmeta(projectId);
  return { success: "Название сохранено", name: saved.name };
}

export async function toggleBudgetSheetPinnedAction(
  projectId: string,
  budgetId: string,
  payload: unknown,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("budget:write")) return { error: "Недостаточно прав" };

  const schema = z.object({
    sheetId: z.string().min(1),
    pinned: z.boolean(),
  });
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { error: "Некорректные данные" };

  const saved = await setBudgetSheetPinned(
    projectId,
    budgetId,
    parsed.data.sheetId,
    parsed.data.pinned,
  );
  if (!saved) return { error: "Лист не найден" };

  revalidateSmeta(projectId);
  return { success: true as const, sheetId: saved.sheetId, pinned: saved.pinned };
}

export type ImportBudgetResult =
  | {
      error: string;
      success?: undefined;
      budgetId?: undefined;
      warnings?: undefined;
      sheetCount?: undefined;
    }
  | {
      error?: undefined;
      success: string;
      budgetId: string;
      name: string;
      updatedAt: string;
      warnings: { code: string; message: string }[];
      sheetCount: number;
    };

/** Import Excel/CSV as a brand-new Budget (one BudgetSheet per workbook sheet). */
export async function importBudgetWorkbookFileAction(
  projectId: string,
  payload: unknown,
): Promise<ImportBudgetResult> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("budget:write")) return { error: "Недостаточно прав" };

  const schema = z.object({
    fileName: z.string().min(1).max(260),
    base64: z.string().min(1),
    /** Optional override; default = filename without extension */
    name: z.string().trim().min(1).max(200).optional(),
  });
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { error: "Некорректный файл" };

  const nameFromFile =
    parsed.data.fileName.replace(/\.(xlsx|xls|xlsm|csv)$/i, "").trim() ||
    "Смета";
  const budgetName = parsed.data.name?.trim() || nameFromFile;

  try {
    let result: ReturnType<typeof excelBufferToUniverWorkbook>;
    if (/\.csv$/i.test(parsed.data.fileName)) {
      const text = Buffer.from(parsed.data.base64, "base64").toString("utf8");
      result = csvTextToUniverWorkbook(text, budgetName);
    } else {
      const buf = Buffer.from(parsed.data.base64, "base64");
      result = excelBufferToUniverWorkbook(buf, budgetName);
    }

    const created = await createBudgetFromSnapshot(
      projectId,
      result.workbook,
      ctx.user.id,
      budgetName,
    );

    const sheets = result.workbook.sheets;
    const sheetCount =
      sheets && typeof sheets === "object"
        ? Object.keys(sheets as Record<string, unknown>).length
        : 0;

    revalidateSmeta(projectId);
    return {
      success: "Смета импортирована как новая",
      budgetId: created.id,
      name: created.name,
      updatedAt: created.updatedAt,
      warnings: result.warnings,
      sheetCount,
    };
  } catch (err) {
    console.error("[importBudgetWorkbook]", err);
    return { error: "Не удалось разобрать файл" };
  }
}
