import { resolveDefaultStatusIdAction } from "@/features/contracts/actions";
import { ContractsWorkspace } from "@/features/contracts/components/contracts-workspace";
import {
  listContractTags,
  listContracts,
  listLedgerTypes,
} from "@/features/contracts/queries";
import {
  listCompanies,
  listCounterparties,
} from "@/features/counterparties/queries";
import { listApprovalStatuses } from "@/features/finance/queries-approval-statuses";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ counterpartyId?: string }>;
};

export default async function ContractsPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const { counterpartyId } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const [contracts, companies, counterparties, ledgerTypes, statuses, tags, statusRes] =
    await Promise.all([
      listContracts(projectId),
      listCompanies(projectId),
      listCounterparties(projectId),
      listLedgerTypes(projectId),
      listApprovalStatuses(projectId),
      listContractTags(projectId),
      resolveDefaultStatusIdAction(projectId),
    ]);

  const defaultStatusId =
    ("id" in statusRes && statusRes.id) || statuses[0]?.id || "";

  return (
    <ContractsWorkspace
      projectId={projectId}
      locale={locale}
      contracts={contracts}
      companies={companies.map((c) => ({ id: c.id, name: c.name }))}
      counterparties={counterparties.map((c) => ({ id: c.id, name: c.name }))}
      ledgerTypes={ledgerTypes.map((t) => ({ id: t.id, name: t.name }))}
      statuses={statuses.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
      }))}
      existingTags={tags}
      defaultStatusId={defaultStatusId}
      canWrite={ctx.can("finance:write")}
      initialCounterpartyId={counterpartyId}
    />
  );
}
