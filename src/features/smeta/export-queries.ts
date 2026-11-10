import "server-only";

import { BudgetVersionFormat, type BudgetStatus } from "@prisma/client";
import {
  resolveBudgetDriveSource,
  type BudgetDriveSource,
} from "@/features/cloud/lib/budget-drive-export-rules";
import type { DepartmentExportSheet } from "@/features/smeta/lib/export-department-xlsx";
import { parseItemsSnapshot, type ItemsSnapshot } from "@/features/smeta/lib/items-snapshot";
import { freezeSheetFormulas } from "@/features/smeta/lib/version-snapshot";
import type { prisma } from "@/shared/db/prisma";

/** Только то, что читает выгрузка (в тестах — поддельный клиент). */
export type ExportDb = Pick<typeof prisma, "budget" | "budgetVersion">;

/** Что выгружается: смета по статьям (снимок) или старая табличная версия (лист со значениями). */
export type DepartmentExportContent =
  | { kind: "items"; snapshot: ItemsSnapshot }
  | { kind: "sheet"; sheet: DepartmentExportSheet };

export type DepartmentBudgetExport = {
  content: DepartmentExportContent;
  source: BudgetDriveSource;
  status: BudgetStatus;
  approved: { at: Date; byName: string; byHead: boolean } | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Смета цеха для выгрузки (Excel и диск): утверждённая версия (её снимок) или текущий черновик
 * по статьям, пересчитанный по действующим значениям переменных (`loadDraft`). Листы-черновики
 * не читаются вовсе. Версия не выбрана: утверждена — последняя утверждённая, иначе черновик.
 * Старые версии табличного формата — их лист, формулы заменены значениями. Права и цех проверяет
 * вызывающий.
 */
export async function loadDepartmentBudgetExport(
  db: ExportDb,
  projectId: string,
  departmentId: string,
  requestedVersion: number | undefined,
  loadDraft: (budgetId: string) => Promise<ItemsSnapshot>,
): Promise<DepartmentBudgetExport | { error: string }> {
  const budget = await db.budget.findFirst({
    where: { projectId, departmentId },
    select: { id: true, status: true },
  });
  if (!budget) return { error: "Смета ещё не создана" };

  const latest = await db.budgetVersion.findFirst({
    where: { projectId, departmentId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const source = resolveBudgetDriveSource(
    { status: budget.status, latestVersion: latest?.number ?? null },
    requestedVersion,
  );

  if (source.kind === "version") {
    const version = await db.budgetVersion.findFirst({
      where: { projectId, departmentId, number: source.number },
      select: {
        format: true,
        snapshot: true,
        sheetName: true,
        sheetData: true,
        styles: true,
        approvedAt: true,
        approvedByName: true,
        approvedByHead: true,
      },
    });
    if (!version) return { error: "Версия не найдена" };
    const approved = { at: version.approvedAt, byName: version.approvedByName, byHead: version.approvedByHead };
    if (version.format === BudgetVersionFormat.ITEMS) {
      const snapshot = parseItemsSnapshot(version.snapshot);
      if (!snapshot) return { error: "Версия не найдена" };
      return { content: { kind: "items", snapshot }, source, status: budget.status, approved };
    }
    if (!isObject(version.sheetData)) return { error: "Версия не найдена" };
    return {
      // Снимок версии уже без формул; повторная заморозка — на случай старых снимков.
      content: {
        kind: "sheet",
        sheet: { name: version.sheetName ?? "Смета", data: freezeSheetFormulas(version.sheetData), styles: version.styles },
      },
      source,
      status: budget.status,
      approved,
    };
  }

  return {
    content: { kind: "items", snapshot: await loadDraft(budget.id) },
    source,
    status: budget.status,
    approved: null,
  };
}
