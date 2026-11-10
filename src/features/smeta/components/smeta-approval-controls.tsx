"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { submitBudgetAction } from "@/features/smeta/actions";
import type { BudgetApprovalInfo } from "@/features/smeta/approval-queries";
import type { VariableChange } from "@/features/smeta/lib/items-snapshot";
import { BudgetCommentModal } from "@/features/smeta/components/budget-comment-modal";
import { SmetaStatusBadge } from "@/features/smeta/components/smeta-status-badge";
import { formatDateTimeShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

const linkClass =
  "inline-flex h-8 items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold hover:bg-[var(--glass-btn-secondary-hover)]";

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
        <Button type="button" className="h-8" onClick={() => setOpen(true)}>
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
export function SmetaApprovalBanner({ info, timeZone }: { info: BudgetApprovalInfo; timeZone?: string | null }) {
  if (info.status === "RETURNED" && info.returnComment) {
    return (
      <div className="border-b border-[var(--tone-danger-line)] bg-[var(--tone-danger-bg)] px-4 py-2 text-sm">
        <span className="font-medium">
          Возвращена{info.returnedByName ? ` — ${info.returnedByName}` : ""}
          {info.returnedAt ? `, ${formatDateTimeShort(info.returnedAt, timeZone)}` : ""}:
        </span>{" "}
        <span className="whitespace-pre-wrap">«{info.returnComment}»</span>
      </div>
    );
  }
  if (info.status === "DRAFT" && info.changedAfterSubmitAt) {
    return (
      <div className="border-b border-[var(--tone-warning-line)] bg-[var(--tone-warning-bg)] px-4 py-2 text-sm">
        Смету изменили после отправки ({formatDateTimeShort(info.changedAfterSubmitAt, timeZone)}) — она
        снова черновик. Продюсер видит её в списке, но утвердить сможет после повторной
        отправки.
      </div>
    );
  }
  if (info.status === "SUBMITTED") {
    return (
      <div className="border-b border-[var(--tone-info-line)] bg-[var(--tone-info-bg)] px-4 py-2 text-sm">
        На утверждении
        {info.submittedAt ? ` с ${formatDateTimeShort(info.submittedAt, timeZone)}` : ""}
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

function variableValueText(value: string | null): string {
  return value == null ? "не задана" : value.replace(".", ",");
}

/**
 * Пометка «изменилась после утверждения»: значения переменных в строках сметы теперь не те, что
 * в утверждённой версии. Версия не меняется, черновик уже пересчитан.
 */
export function SmetaVariableChangesBanner({
  changes,
  versionNumber,
  action,
}: {
  changes: readonly VariableChange[];
  versionNumber: number | null;
  /** «Утвердить пересчёт» — продюсеру, если строки не менялись. */
  action?: ReactNode;
}) {
  if (changes.length === 0) return null;
  return (
    <div
      className="border-b border-[var(--tone-warning-line)] bg-[var(--tone-warning-bg)] px-4 py-2 text-sm"
      data-variables-changed
    >
      <span className="font-medium">
        Изменилась после утверждения{versionNumber ? ` версии ${versionNumber}` : ""}:
      </span>{" "}
      {changes.map((c, index) => (
        <span key={c.label}>
          {index > 0 ? ", " : ""}
          {c.label} {variableValueText(c.before)} → {variableValueText(c.after)}
        </span>
      ))}
      . Суммы черновика пересчитаны, утверждённая версия не изменилась.
      {action ? <div className="mt-2 flex flex-wrap items-center gap-3">{action}</div> : null}
    </div>
  );
}
