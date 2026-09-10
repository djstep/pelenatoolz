import { notFound } from "next/navigation";
import { resolveDefaultStatusIdAction } from "@/features/contracts/actions";
import { ContractDetailView } from "@/features/contracts/components/contract-detail-view";
import {
  getContract,
  listContractTags,
  listLedgerTypes,
} from "@/features/contracts/queries";
import {
  listCompanies,
  listCounterparties,
} from "@/features/counterparties/queries";
import { listApprovalStatuses } from "@/features/finance/queries-approval-statuses";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string; contractId: string }>;
};

export default async function ContractPage({ params }: Props) {
  const { locale, projectId, contractId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const [contract, companies, counterparties, ledgerTypes, statuses, tags, statusRes] =
    await Promise.all([
      getContract(projectId, contractId),
      listCompanies(projectId),
      listCounterparties(projectId),
      listLedgerTypes(projectId),
      listApprovalStatuses(projectId),
      listContractTags(projectId),
      resolveDefaultStatusIdAction(projectId),
    ]);

  if (!contract) notFound();

  const defaultStatusId =
    ("id" in statusRes && statusRes.id) || statuses[0]?.id || "";

  return (
    <ContractDetailView
      projectId={projectId}
      locale={locale}
      contract={contract}
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
    />
  );
}
