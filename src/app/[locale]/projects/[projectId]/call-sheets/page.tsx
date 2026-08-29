import { DayDocsIndex } from "@/features/day-docs/components/day-docs-index";
import { listShootDaysBrief } from "@/features/day-docs/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function CallSheetsPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("callsheet:read") && !ctx.can("schedule:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к вызывным</p>;
  }

  const days = await listShootDaysBrief(projectId);

  return (
    <DayDocsIndex
      locale={locale}
      projectId={projectId}
      days={days}
      kind="call-sheets"
    />
  );
}
