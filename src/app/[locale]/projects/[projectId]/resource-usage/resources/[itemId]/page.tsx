import { notFound } from "next/navigation";
import { UsageLedgerDetailView } from "@/features/payroll/components/usage-ledger-detail-view";
import { getUsageLedgerResourceDetail } from "@/features/payroll/queries-usage-ledger";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { resourceItemPath } from "@/features/resources/lib/paths";

type Props = {
  params: Promise<{ locale: string; projectId: string; itemId: string }>;
};

export default async function ResourceUsageResourceDetailPage({
  params,
}: Props) {
  const { locale, projectId, itemId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read") && !ctx.can("script:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к ведомости</p>
    );
  }

  const detail = await getUsageLedgerResourceDetail(projectId, itemId);
  if (!detail) notFound();

  if (!ctx.canFinanceRead({ categoryId: detail.categoryId })) {
    return (
      <p className="text-sm text-[var(--danger)]">
        Нет прав на просмотр финансовых условий этой категории ресурсов
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
      cardHref={resourceItemPath(
        locale,
        projectId,
        detail.categoryId,
        itemId,
      )}
      cardLabel="Карточка ресурса"
      rows={detail.rows}
      canEdit={ctx.can("script:write") || ctx.can("finance:write")}
    />
  );
}
