import { isWorkingShootDay } from "@/features/schedule/lib/shoot-day-type";
import {
  AWAITING_APPROVAL_FILTER,
  CALL_SHEET_APPROVE_PERMISSION,
  isAwaitingApproval,
} from "@/features/call-sheets/lib/awaiting-approval";
import { DayDocsIndex } from "@/features/day-docs/components/day-docs-index";
import { listShootDaysBrief } from "@/features/day-docs/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ filter?: string }>;
};

export default async function CallSheetsPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const { filter } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("callsheet:read") && !ctx.can("schedule:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к вызывным</p>;
  }

  const days = (await listShootDaysBrief(projectId)).filter((d) =>
    isWorkingShootDay(d.dayType),
  );

  // «Ждут утверждения: N» с фильтром — только тому, кто может утвердить.
  const canApprove = ctx.can(CALL_SHEET_APPROVE_PERMISSION);
  const awaiting = canApprove ? days.filter((d) => isAwaitingApproval(d.callSheet)) : [];
  const onlyAwaiting = canApprove && filter === AWAITING_APPROVAL_FILTER;

  return (
    <DayDocsIndex
      locale={locale}
      projectId={projectId}
      days={onlyAwaiting ? awaiting : days}
      kind="call-sheets"
      awaitingApproval={
        canApprove ? { count: awaiting.length, active: onlyAwaiting } : undefined
      }
    />
  );
}
