"use client";

import dynamic from "next/dynamic";
import type { SmetaCheck } from "@/features/smeta/lib/main-sheet";
import type { BudgetClient } from "@/features/smeta/queries";

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
  department,
  budget,
  canWrite,
  initialChecks,
  usedCodes,
  listHref,
}: {
  projectId: string;
  department: { id: string; name: string; codePrefix: string };
  budget: BudgetClient;
  canWrite: boolean;
  initialChecks: SmetaCheck[];
  usedCodes: string[];
  listHref: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SmetaSpreadsheetEditor
        key={budget.id}
        projectId={projectId}
        department={department}
        budget={budget}
        canWrite={canWrite}
        initialChecks={initialChecks}
        usedCodes={usedCodes}
        listHref={listHref}
      />
    </div>
  );
}
