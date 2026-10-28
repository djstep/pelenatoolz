import { notFound } from "next/navigation";
import { resolveDefaultStatusId } from "@/features/contracts/lib/default-status";
import {
  certificateWithoutFinance,
  contractFinanceAccess,
  withoutAmounts,
} from "@/features/contracts/lib/finance-access";
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

  if (!ctx.can("contracts:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к договорам</p>
    );
  }
  const finance = contractFinanceAccess(ctx.can);

  const [contract, companies, counterparties, ledgerTypes, statuses, tags, statusRes] =
    await Promise.all([
      getContract(projectId, contractId),
      listCompanies(projectId),
      listCounterparties(projectId),
      listLedgerTypes(projectId),
      listApprovalStatuses(projectId),
      listContractTags(projectId),
      resolveDefaultStatusId(projectId),
    ]);

  if (!contract) notFound();

  // Без права на финансы суммы, платежи и начисления в браузер не уходят.
  const visibleContract = finance.read
    ? contract
    : {
        ...withoutAmounts(contract),
        cashPayments: [],
        accruals: [],
        certificates: contract.certificates.map(certificateWithoutFinance),
        _count: { ...contract._count, cashPayments: 0, accruals: 0 },
      };

  const defaultStatusId =
    ("id" in statusRes && statusRes.id) || statuses[0]?.id || "";

  return (
    <ContractDetailView
      projectId={projectId}
      locale={locale}
      contract={visibleContract}
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
      canWrite={ctx.can("contracts:write")}
      finance={finance}
      canCreateParties={ctx.can("finance:write")}
    />
  );
}
