"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BudgetApprovalInfo } from "@/features/smeta/approval-queries";
import { BudgetDriveExport } from "@/features/smeta/components/budget-drive-export";
import { BudgetExcelExportButton } from "@/features/smeta/components/budget-excel-export-button";
import { BudgetItemsReference } from "@/features/smeta/components/budget-items-reference";
import { BudgetItemsTable, type DirtyRows } from "@/features/smeta/components/budget-items-table";
import { SmetaApprovalBanner, SmetaApprovalControls } from "@/features/smeta/components/smeta-approval-controls";
import type { BudgetDriveButton } from "@/features/smeta/drive-queries";
import type { DepartmentItemsTree, ItemsDictionaries } from "@/features/smeta/items-queries";
import type { BudgetClient } from "@/features/smeta/queries";
import { cn } from "@/shared/lib/cn";

const SmetaSpreadsheetEditor = dynamic(
  () => import("@/features/smeta/components/smeta-spreadsheet-editor").then((m) => m.SmetaSpreadsheetEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted-fg)]">
        Загрузка листов…
      </div>
    ),
  },
);

export type DepartmentViewTab = "items" | "drafts";

/**
 * Экран сметы цеха: шапка (статус, утверждение, выгрузки) и две вкладки — «Смета» (статьи,
 * подстатьи, строки) и «Черновики» (листы Excel, в смету не входят).
 */
export function BudgetDepartmentView({
  projectId,
  department,
  tab,
  hrefs,
  canWrite,
  revision,
  approval,
  driveButton,
  items,
  drafts,
}: {
  projectId: string;
  department: { id: string; name: string; codePrefix: string };
  tab: DepartmentViewTab;
  hrefs: { list: string; items: string; drafts: string; settings: string | null };
  canWrite: boolean;
  revision: number;
  approval?: { info: BudgetApprovalInfo; canApprove: boolean; reviewHref: string; versionsHref: string };
  driveButton: BudgetDriveButton | null;
  items: { tree: DepartmentItemsTree; dictionaries: ItemsDictionaries } | null;
  drafts: { book: BudgetClient; unsavedSheetKeys: string[] } | null;
}) {
  const [dirtyRows] = useState<DirtyRows>(() => new Map());
  const revisionRef = useRef(revision);
  useEffect(() => {
    revisionRef.current = Math.max(revisionRef.current, revision);
  }, [revision]);
  const onRevision = useCallback((next: number) => {
    revisionRef.current = Math.max(revisionRef.current, next);
  }, []);

  /** Досохранить строки, которые правят сейчас. false — что-то не сохранилось. */
  const saveRows = useCallback(async () => {
    for (const save of [...dirtyRows.values()]) if (!(await save())) return false;
    return true;
  }, [dirtyRows]);
  const flushSave = useCallback(async () => ((await saveRows()) ? revisionRef.current : null), [saveRows]);

  const tabClass = (active: boolean) =>
    cn(
      "rounded-md px-3 py-1 text-sm",
      active ? "bg-[var(--surface)] font-semibold shadow-sm" : "text-[var(--muted-fg)] hover:text-[var(--foreground)]",
    );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={hrefs.list} className="text-[13px] text-[var(--accent)] hover:underline">
            ← Все сметы
          </Link>
          <h2 className="font-display text-[27px] leading-tight font-bold">Смета — {department.name}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {approval ? (
            <SmetaApprovalControls
              projectId={projectId}
              departmentId={department.id}
              info={approval.info}
              canWrite={canWrite}
              canApprove={approval.canApprove}
              reviewHref={approval.reviewHref}
              versionsHref={approval.versionsHref}
              flushSave={flushSave}
            />
          ) : null}
          <BudgetExcelExportButton
            projectId={projectId}
            departmentId={department.id}
            className="h-8"
            beforeExport={canWrite ? saveRows : undefined}
          />
          <BudgetDriveExport
            projectId={projectId}
            departmentId={department.id}
            button={driveButton}
            className="h-8"
            beforeExport={canWrite ? saveRows : undefined}
          />
        </div>
      </header>

      {approval ? (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] empty:hidden">
          <SmetaApprovalBanner info={approval.info} />
        </div>
      ) : null}

      <nav className="inline-flex w-fit gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1" aria-label="Разделы сметы">
        <Link href={hrefs.items} className={tabClass(tab === "items")} aria-current={tab === "items" ? "page" : undefined}>
          Смета
        </Link>
        <Link href={hrefs.drafts} className={tabClass(tab === "drafts")} aria-current={tab === "drafts" ? "page" : undefined}>
          Черновики
        </Link>
      </nav>

      {tab === "items" && items ? (
        <>
          <BudgetItemsReference
            variables={items.tree.variables}
            paymentForms={items.dictionaries.paymentForms}
            settingsHref={hrefs.settings}
          />
          <BudgetItemsTable
            projectId={projectId}
            departmentId={department.id}
            tree={items.tree}
            dictionaries={items.dictionaries}
            canWrite={canWrite}
            dirtyRows={dirtyRows}
            onRevision={onRevision}
          />
        </>
      ) : null}

      {tab === "drafts" && drafts ? (
        <div className="flex min-h-[640px] flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] lg:min-h-[560px]">
          <SmetaSpreadsheetEditor
            key={drafts.book.id}
            projectId={projectId}
            department={department}
            budget={drafts.book}
            canWrite={canWrite}
            initialChecks={[]}
            usedCodes={[]}
            listHref={hrefs.list}
            mode="drafts"
            unsavedSheetKeys={drafts.unsavedSheetKeys}
          />
        </div>
      ) : null}
    </div>
  );
}
