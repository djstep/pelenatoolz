import { resolveDefaultStatusId } from "@/features/contracts/lib/default-status";
import {
  certificateWithoutFinance,
  contractFinanceAccess,
} from "@/features/contracts/lib/finance-access";
import { CertificatesWorkspace } from "@/features/contracts/components/certificates-workspace";
import {
  listCertificates,
  listContracts,
  listPaymentsForCertificateForm,
} from "@/features/contracts/queries";
import {
  listCompanies,
  listCounterparties,
} from "@/features/counterparties/queries";
import { listApprovalStatuses } from "@/features/finance/queries-approval-statuses";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{
    counterpartyId?: string;
    contractId?: string;
    paymentId?: string;
  }>;
};

export default async function ActsPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const { counterpartyId, contractId, paymentId } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("contracts:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к договорам</p>
    );
  }
  const finance = contractFinanceAccess(ctx.can);

  const [
    certificates,
    companies,
    counterparties,
    contracts,
    payments,
    statuses,
    statusRes,
  ] = await Promise.all([
    listCertificates(projectId),
    listCompanies(projectId),
    listCounterparties(projectId),
    listContracts(projectId),
    finance.read ? listPaymentsForCertificateForm(projectId) : [],
    listApprovalStatuses(projectId),
    resolveDefaultStatusId(projectId),
  ]);

  const defaultStatusId =
    ("id" in statusRes && statusRes.id) || statuses[0]?.id || "";

  return (
    <CertificatesWorkspace
      projectId={projectId}
      certificates={
        finance.read
          ? certificates
          : certificates.map(certificateWithoutFinance)
      }
      companies={companies.map((c) => ({ id: c.id, name: c.name }))}
      counterparties={counterparties.map((c) => ({ id: c.id, name: c.name }))}
      contracts={contracts.map((c) => ({
        id: c.id,
        number: c.number,
        companyId: c.companyId,
        counterpartyId: c.counterpartyId,
      }))}
      payments={payments.map((p) => ({
        ...p,
        amountWithTax: Number(p.amountWithTax),
      }))}
      statuses={statuses.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
      }))}
      defaultStatusId={defaultStatusId}
      canWrite={ctx.can("contracts:write")}
      finance={finance}
      canCreateParties={ctx.can("finance:write")}
      initialCounterpartyId={counterpartyId}
      initialContractId={contractId}
      initialPaymentId={paymentId}
    />
  );
}
