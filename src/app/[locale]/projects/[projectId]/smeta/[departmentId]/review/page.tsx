import Link from "next/link";
import { notFound } from "next/navigation";
import { getBudgetReview } from "@/features/smeta/approval-queries";
import { BudgetDiffTable } from "@/features/smeta/components/budget-diff-table";
import { BudgetReviewActions } from "@/features/smeta/components/budget-review-actions";
import { SmetaVariableChangesBanner } from "@/features/smeta/components/smeta-approval-controls";
import { SmetaStatusBadge } from "@/features/smeta/components/smeta-status-badge";
import { countOf } from "@/shared/lib/plural";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  canApproveSmeta,
  canReadDepartmentSmeta,
} from "@/features/smeta/lib/smeta-access";
import { prisma } from "@/shared/db/prisma";
import { formatDateTimeShort } from "@/shared/i18n/format-date";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string; departmentId: string }>;
};

export default async function BudgetReviewPage({ params }: Props) {
  const { locale, projectId, departmentId } = await params;
  const ctx = await requireProjectContext(projectId);

  // Нет цеха в проекте и нет доступа — одинаково «не найдено».
  if (!canReadDepartmentSmeta(ctx, departmentId)) notFound();
  const department = await prisma.department.findFirst({
    where: { id: departmentId, projectId },
    select: { id: true, name: true },
  });
  if (!department) notFound();
  const review = await getBudgetReview(projectId, department.id);
  if (!review) notFound();

  const { info, diff, nextNumber, fingerprint, incomplete, lineCount, variableChanges } = review;
  const departmentHref = `/${locale}/projects/${projectId}/smeta/${department.id}`;
  const changedAfterSubmit = info.changedAfterSubmitAt !== null;
  const canApprove = canApproveSmeta(ctx);
  // Строки без суммы и пустая смета не утверждаются — сервер тоже откажет.
  const canApproveNow = canApprove && info.status === "SUBMITTED" && incomplete === 0 && lineCount > 0;
  const canReturn = canApprove && (info.status === "SUBMITTED" || changedAfterSubmit);
  const beforeLabel = info.lastVersion
    ? `утверждённой версии ${info.lastVersion.number}`
    : "пустого плана";

  return (
    <div className="space-y-6">
      <Link href={departmentHref} className="text-sm text-[var(--muted-fg)] hover:underline">
        ← Смета цеха
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-[27px] font-bold leading-tight">Сравнение — {department.name}</h2>
        <SmetaStatusBadge
          status={info.status}
          changedAfterSubmit={changedAfterSubmit}
          versionNumber={info.lastVersion?.number ?? null}
        />
      </div>

      {variableChanges.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          <SmetaVariableChangesBanner changes={variableChanges} versionNumber={info.lastVersion?.number ?? null} />
        </div>
      ) : null}

      <Card className="space-y-3 text-sm">
        <p>
          {info.lastVersion ? (
            <>
              Утверждённая версия {info.lastVersion.number} от{" "}
              {formatDateTimeShort(info.lastVersion.approvedAt)} (утвердил{" "}
              {info.lastVersion.approvedByName}) ↔ текущий черновик.{" "}
              <Link href={`${departmentHref}/versions`} className="underline">
                Все версии
              </Link>
            </>
          ) : (
            <>
              Утверждённых версий нет: план цеха пуст, все траты пока идут как «без плана».
              Ниже — все строки черновика; утверждение создаст версию 1.
            </>
          )}
        </p>

        {info.status === "SUBMITTED" || changedAfterSubmit ? (
          <p>
            Отправлена{info.submittedByName ? ` — ${info.submittedByName}` : ""}
            {info.submittedAt ? `, ${formatDateTimeShort(info.submittedAt)}` : ""}
            {info.submitComment ? (
              <>
                : <span className="whitespace-pre-wrap">«{info.submitComment}»</span>
              </>
            ) : (
              ", без комментария"
            )}
          </p>
        ) : null}

        {changedAfterSubmit ? (
          <p className="rounded-md bg-[var(--row-warning)] px-3 py-2">
            Смету изменили после отправки ({formatDateTimeShort(info.changedAfterSubmitAt!)}).
            Ниже — текущий черновик. Утвердить можно после повторной отправки главой; вернуть
            с комментарием — можно сейчас.
          </p>
        ) : null}

        {info.status === "RETURNED" && info.returnComment ? (
          <p className="rounded-md bg-[var(--row-danger)] px-3 py-2">
            Возвращена{info.returnedByName ? ` — ${info.returnedByName}` : ""}
            {info.returnedAt ? `, ${formatDateTimeShort(info.returnedAt)}` : ""}:{" "}
            <span className="whitespace-pre-wrap">«{info.returnComment}»</span>
          </p>
        ) : null}

        {incomplete > 0 ? (
          <p className="rounded-md bg-[var(--row-warning)] px-3 py-2" data-review-incomplete>
            В черновике {countOf(incomplete, ["строка", "строки", "строк"])} без суммы (не задана
            переменная или нет кол-ва и ставки). Утвердить нельзя, пока глава их не заполнит или не
            уберёт в архив.
          </p>
        ) : null}

        {canApproveNow || canReturn ? (
          <BudgetReviewActions
            projectId={projectId}
            departmentId={department.id}
            fingerprint={fingerprint}
            nextNumber={nextNumber}
            canApproveNow={canApproveNow}
            canReturn={canReturn}
            versionsHref={`${departmentHref}/versions`}
          />
        ) : null}
      </Card>

      <Card>
        <BudgetDiffTable diff={diff} beforeLabel={beforeLabel} />
      </Card>
    </div>
  );
}
