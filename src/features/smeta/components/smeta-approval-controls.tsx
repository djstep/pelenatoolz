"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitBudgetAction } from "@/features/smeta/actions";
import type { BudgetApprovalInfo } from "@/features/smeta/approval-queries";
import { BudgetCommentModal } from "@/features/smeta/components/budget-comment-modal";
import { SmetaStatusBadge } from "@/features/smeta/components/smeta-status-badge";
import { formatDateTimeShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

const linkClass =
  "inline-flex h-9 items-center rounded-md border border-[var(--border)] px-3 text-sm hover:bg-[var(--nav-hover-bg)]";

/** Статус, «Отправить на утверждение», ссылки на сравнение и версии — в шапке редактора. */
export function SmetaApprovalControls({
  projectId,
  departmentId,
  info,
  canWrite,
  canApprove,
  reviewHref,
  versionsHref,
  flushSave,
}: {
  projectId: string;
  departmentId: string;
  info: BudgetApprovalInfo;
  canWrite: boolean;
  canApprove: boolean;
  reviewHref: string;
  versionsHref: string;
  /** Сохранить несохранённое и вернуть ревизию книги (null — не сохранилось). */
  flushSave: () => Promise<number | null>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const canSubmit = canWrite && (info.status === "DRAFT" || info.status === "RETURNED");
  const waiting = info.status === "SUBMITTED" || info.changedAfterSubmitAt !== null;

  return (
    <>
      <SmetaStatusBadge
        status={info.status}
        changedAfterSubmit={info.changedAfterSubmitAt !== null}
        versionNumber={info.lastVersion?.number ?? null}
      />
      {canSubmit ? (
        <Button type="button" className="h-9" onClick={() => setOpen(true)}>
          Отправить на утверждение
        </Button>
      ) : null}
      <Link href={reviewHref} className={linkClass}>
        {canApprove && waiting ? "Сравнить и утвердить" : "Сравнение"}
      </Link>
      {info.lastVersion ? (
        <Link href={versionsHref} className={linkClass}>
          Версии
        </Link>
      ) : null}

      <BudgetCommentModal
        open={open}
        onClose={() => setOpen(false)}
        title="Отправить на утверждение"
        description={
          info.lastVersion
            ? `Продюсер увидит разницу с утверждённой версией ${info.lastVersion.number}.`
            : "Утверждённых версий ещё нет — это будет версия 1."
        }
        label="Комментарий для продюсера (необязательно)"
        placeholder="Что изменилось и почему"
        submitLabel="Отправить"
        onSubmit={async (comment) => {
          const revision = await flushSave();
          if (revision === null) return "Смета не сохранилась — отправить нельзя";
          const result = await submitBudgetAction(projectId, departmentId, {
            revision,
            comment,
          });
          if (result.error) return result.error;
          toast.success(result.success ?? "Отправлено");
          router.refresh();
          return null;
        }}
      />
    </>
  );
}

/** Плашка под шапкой: возврат с комментарием, «изменена после отправки», «на утверждении». */
export function SmetaApprovalBanner({ info }: { info: BudgetApprovalInfo }) {
  if (info.status === "RETURNED" && info.returnComment) {
    return (
      <div className="border-b border-[var(--border)] bg-[var(--row-danger)] px-4 py-2 text-sm">
        <span className="font-medium">
          Возвращена{info.returnedByName ? ` — ${info.returnedByName}` : ""}
          {info.returnedAt ? `, ${formatDateTimeShort(info.returnedAt)}` : ""}:
        </span>{" "}
        <span className="whitespace-pre-wrap">«{info.returnComment}»</span>
      </div>
    );
  }
  if (info.status === "DRAFT" && info.changedAfterSubmitAt) {
    return (
      <div className="border-b border-[var(--border)] bg-[var(--row-warning)] px-4 py-2 text-sm">
        Смету изменили после отправки ({formatDateTimeShort(info.changedAfterSubmitAt)}) — она
        снова черновик. Продюсер видит её в списке, но утвердить сможет после повторной
        отправки.
      </div>
    );
  }
  if (info.status === "SUBMITTED") {
    return (
      <div className="border-b border-[var(--border)] bg-[var(--row-neutral)] px-4 py-2 text-sm">
        На утверждении
        {info.submittedAt ? ` с ${formatDateTimeShort(info.submittedAt)}` : ""}
        {info.submittedByName ? ` (отправил ${info.submittedByName})` : ""}
        {info.submitComment ? (
          <>
            : <span className="whitespace-pre-wrap">«{info.submitComment}»</span>
          </>
        ) : null}
        . Если править смету сейчас, она вернётся в черновик.
      </div>
    );
  }
  return null;
}
