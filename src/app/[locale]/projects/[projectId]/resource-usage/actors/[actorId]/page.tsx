import { notFound } from "next/navigation";
import { UsageLedgerDetailView } from "@/features/payroll/components/usage-ledger-detail-view";
import { getUsageLedgerActorDetail } from "@/features/payroll/queries-usage-ledger";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string; actorId: string }>;
};

export default async function ResourceUsageActorDetailPage({ params }: Props) {
  const { locale, projectId, actorId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read") && !ctx.can("script:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к ведомости</p>
    );
  }

  const detail = await getUsageLedgerActorDetail(projectId, actorId);
  if (!detail) notFound();

  if (!ctx.canFinanceRead("actors")) {
    return (
      <p className="text-sm text-[var(--danger)]">
        Нет прав на просмотр финансовых условий актёров
      </p>
    );
  }

  return (
    <UsageLedgerDetailView
      locale={locale}
      projectId={projectId}
      title={detail.title}
      subtitle={detail.subtitle}
      backHref={`/${locale}/projects/${projectId}/resource-usage`}
      backLabel="К сводной ведомости"
      cardHref={
        detail.characterId
          ? `/${locale}/projects/${projectId}/characters/${detail.characterId}`
          : null
      }
      cardLabel="Карточка персонажа"
      rows={detail.rows}
      canEdit={ctx.can("cast:write") || ctx.can("finance:write")}
    />
  );
}
