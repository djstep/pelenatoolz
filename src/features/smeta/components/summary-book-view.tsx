"use client";

import Link from "next/link";
import { useTransition } from "react";
import { SmetaWorkspace } from "@/features/smeta/components/smeta-workspace";
import { exportSummaryBookAction } from "@/features/smeta/export-actions";
import { downloadBase64Xlsx } from "@/features/smeta/lib/download-xlsx";
import type { BudgetClient } from "@/features/smeta/queries";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

const SUMMARY_DEPARTMENT = { id: "summary", name: "Сводная книга", codePrefix: "" };

/** Сводная книга продюсера: «Свод» и листы цехов, только чтение. */
export function SummaryBookView({
  projectId,
  book,
  drafts,
  baseHref,
  listHref,
}: {
  projectId: string;
  book: BudgetClient;
  drafts: boolean;
  baseHref: string;
  listHref: string;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const tab = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-1.5 text-sm transition",
      active
        ? "bg-[rgb(var(--tint-rgb)/0.1)] text-[var(--foreground)]"
        : "text-[var(--muted-fg)] hover:bg-[rgb(var(--tint-rgb)/0.05)]",
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={baseHref} className={tab(!drafts)} aria-current={!drafts ? "page" : undefined}>
          Утверждённые версии
        </Link>
        <Link
          href={`${baseHref}?drafts=1`}
          className={tab(drafts)}
          aria-current={drafts ? "page" : undefined}
        >
          Показать черновики
        </Link>
        <Button
          type="button"
          variant="secondary"
          className="ml-auto"
          disabled={pending}
          onClick={() => {
            start(async () => {
              const res = await exportSummaryBookAction(projectId, { drafts });
              if (res.error !== undefined) {
                toast.error(res.error);
                return;
              }
              downloadBase64Xlsx(res.base64, res.fileName);
              toast.success("Excel скачан");
            });
          }}
        >
          {pending ? "…" : "Экспорт Excel"}
        </Button>
      </div>
      <p className="text-sm text-[var(--muted-fg)]">
        {drafts
          ? "Листы цехов — текущие черновики (формулы показаны значениями). В «Своде» план — по утверждённым версиям, рядом итог черновика."
          : "Листы цехов — последние утверждённые версии."}{" "}
        Факт в «Своде» — за всё время, все суммы с налогом.
      </p>
      <div className="flex h-[70vh] min-h-[420px] flex-col">
        <SmetaWorkspace
          projectId={projectId}
          department={SUMMARY_DEPARTMENT}
          budget={book}
          canWrite={false}
          initialChecks={[]}
          usedCodes={[]}
          listHref={listHref}
          mode="summary"
          title="Сводная книга"
        />
      </div>
    </div>
  );
}
