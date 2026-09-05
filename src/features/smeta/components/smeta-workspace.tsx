"use client";

import dynamic from "next/dynamic";
import type {
  BudgetClient,
  BudgetListItem,
} from "@/features/smeta/queries";

const SmetaSpreadsheetEditor = dynamic(
  () =>
    import("@/features/smeta/components/smeta-spreadsheet-editor").then(
      (m) => m.SmetaSpreadsheetEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[65vh] items-center justify-center rounded-xl border border-[var(--border)] text-sm text-[var(--muted-fg)]">
        Загрузка табличного редактора…
      </div>
    ),
  },
);

export function SmetaWorkspace({
  projectId,
  budget,
  budgets,
  canWrite,
}: {
  projectId: string;
  budget: BudgetClient;
  budgets: BudgetListItem[];
  canWrite: boolean;
}) {
  return (
    <SmetaSpreadsheetEditor
      key={budget.id}
      projectId={projectId}
      budget={budget}
      budgets={budgets}
      canWrite={canWrite}
    />
  );
}
