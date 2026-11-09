import "server-only";

import type { BudgetStatus } from "@prisma/client";
import {
  resolveBudgetDriveSource,
  type BudgetDriveSource,
} from "@/features/cloud/lib/budget-drive-export-rules";
import type { DepartmentExportSheet } from "@/features/smeta/lib/export-department-xlsx";
import { findMainColumns, type MainSheetLike } from "@/features/smeta/lib/main-sheet";
import { freezeSheetFormulas } from "@/features/smeta/lib/version-snapshot";
import type { prisma } from "@/shared/db/prisma";

/** Только то, что читает выгрузка (в тестах — поддельный клиент). */
export type ExportDb = Pick<typeof prisma, "budget" | "budgetVersion" | "budgetItem">;

export type DepartmentBudgetExport = {
  sheet: DepartmentExportSheet;
  source: BudgetDriveSource;
  status: BudgetStatus;
  approved: { at: Date; byName: string; byHead: boolean } | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Основной лист сметы цеха для выгрузки (Excel и диск): утверждённая версия (снимок) или текущий
 * основной лист — формулы заменены значениями, Сумма / Налог / Итого статей — серверный расчёт,
 * как при утверждении. Другие листы книги не читаются вовсе. Версия не выбрана — утверждена →
 * последняя утверждённая, иначе текущий лист. Права и цех проверяет вызывающий.
 */
export async function loadDepartmentBudgetExport(
  db: ExportDb,
  projectId: string,
  departmentId: string,
  requestedVersion: number | undefined,
): Promise<DepartmentBudgetExport | { error: string }> {
  const budget = await db.budget.findFirst({
    where: { projectId, departmentId },
    select: {
      status: true,
      styles: true,
      mainSheet: { select: { name: true, data: { select: { data: true } } } },
    },
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
        sheetName: true,
        sheetData: true,
        styles: true,
        approvedAt: true,
        approvedByName: true,
        approvedByHead: true,
      },
    });
    if (!version || !isObject(version.sheetData)) return { error: "Версия не найдена" };
    return {
      // Снимок версии уже без формул; повторная заморозка — на случай старых снимков.
      sheet: { name: version.sheetName ?? "Смета", data: freezeSheetFormulas(version.sheetData), styles: version.styles },
      source,
      status: budget.status,
      approved: { at: version.approvedAt, byName: version.approvedByName, byHead: version.approvedByHead },
    };
  }

  const raw = budget.mainSheet?.data?.data;
  if (!budget.mainSheet || !isObject(raw)) return { error: "Основной лист сметы не найден" };
  const items = await db.budgetItem.findMany({
    where: { projectId, departmentId, archivedAt: null },
    select: { sortOrder: true, amount: true, tax: true, total: true },
  });
  const data = freezeSheetFormulas(
    raw,
    findMainColumns(raw as MainSheetLike).columns,
    items.map((i) => ({
      row: i.sortOrder,
      amount: Number(i.amount),
      tax: Number(i.tax),
      total: Number(i.total),
    })),
  );
  return {
    sheet: { name: budget.mainSheet.name, data, styles: budget.styles },
    source,
    status: budget.status,
    approved: null,
  };
}
