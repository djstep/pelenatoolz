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
      <div className="smeta-editor--embedded flex flex-1 items-center justify-center text-sm text-[var(--foreground)]/80">
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
    <div className="flex min-h-0 flex-1 flex-col">
      <SmetaSpreadsheetEditor
        key={budget.id}
        projectId={projectId}
        budget={budget}
        budgets={budgets}
        canWrite={canWrite}
      />
    </div>
  );
}
