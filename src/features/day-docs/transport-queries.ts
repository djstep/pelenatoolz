import "server-only";

import {
  canEditTransportFinance,
  canSeeTransportKmRate,
  toEditorRow,
  type StoredTransport,
  type TransportEditorRow,
} from "@/features/day-docs/lib/transport-rules";
import { canEditCallSheets } from "@/features/call-sheets/lib/template-rules";
import type { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  describeBudgetItems,
  listVisibleBudgetItems,
} from "@/features/smeta/budget-item-access";
import type { BudgetItemOption } from "@/features/smeta/lib/budget-item-option";
import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";

type ProjectContext = Awaited<ReturnType<typeof requireProjectContext>>;

/** Строки спецтранспорта дня по порядку. День должен быть уже проверен на проект. */
export async function loadDayTransports(shootDayId: string): Promise<StoredTransport[]> {
  const rows = await prisma.shootDayTransport.findMany({
    where: { shootDayId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      callTime: true,
      wrapTime: true,
      scenes: true,
      notes: true,
      kmRate: true,
      budgetItemId: true,
      sortOrder: true,
    },
  });
  return rows.map((row) => ({ ...row, kmRate: dec(row.kmRate) }));
}

export type CallSheetTransportEditorData = {
  rows: TransportEditorRow[];
  /** Статьи для выбора (видимые сметы, не архив); без фин. права — пусто */
  budgetItems: BudgetItemOption[];
  /** Подписи статей, которые уже стоят на строках (в т.ч. архивных и чужих смет) */
  currentBudgetItems: Record<string, BudgetItemOption>;
  /** «Финансы: правка» — можно ставить и менять статью и ставку км */
  canEditFinance: boolean;
  /** Ставку км видно (без права ставка в браузер не уходит) */
  canSeeKmRate: boolean;
};

/**
 * Данные редактора спецтранспорта вызывного. null — нет права правки вызывного
 * («КПП и вызывные: правка») или день не этого проекта. Ничего не пишет.
 */
export async function getCallSheetTransportEditor(
  ctx: ProjectContext,
  projectId: string,
  dayId: string,
): Promise<CallSheetTransportEditorData | null> {
  if (!canEditCallSheets(ctx)) return null;
  const day = await prisma.shootDay.findFirst({
    where: { id: dayId, projectId },
    select: { id: true },
  });
  if (!day) return null;

  const canEditFinance = canEditTransportFinance(ctx);
  const canSeeKmRate = canSeeTransportKmRate(ctx);
  const stored = await loadDayTransports(day.id);
  const [budgetItems, currentBudgetItems] = await Promise.all([
    canEditFinance ? listVisibleBudgetItems(projectId, ctx) : Promise.resolve([]),
    describeBudgetItems(
      projectId,
      ctx,
      stored.map((row) => row.budgetItemId),
    ),
  ]);

  return {
    rows: stored.map((row) => toEditorRow(row, canSeeKmRate)),
    budgetItems,
    currentBudgetItems,
    canEditFinance,
    canSeeKmRate,
  };
}
