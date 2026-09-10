import { notFound } from "next/navigation";
import { resolveDefaultStatusIdAction } from "@/features/contracts/actions";
import {
  listCertificates,
  listContractTags,
  listContracts,
  listLedgerTypes,
  listPaymentsForCertificateForm,
} from "@/features/contracts/queries";
import { CounterpartyDetailView } from "@/features/counterparties/components/counterparty-detail-view";
import {
  getCounterparty,
  listCompanies,
  listCounterparties,
} from "@/features/counterparties/queries";
import { listApprovalStatuses } from "@/features/finance/queries-approval-statuses";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{
    locale: string;
    projectId: string;
    counterpartyId: string;
  }>;
};

export default async function CounterpartyDetailPage({ params }: Props) {
  const { locale, projectId, counterpartyId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const [
    counterparty,
    allContracts,
    allCertificates,
    allPayments,
    companies,
    counterparties,
    ledgerTypes,
    statuses,
    tags,
    statusRes,
  ] = await Promise.all([
    getCounterparty(projectId, counterpartyId),
    listContracts(projectId),
    listCertificates(projectId),
    listPaymentsForCertificateForm(projectId),
    listCompanies(projectId),
    listCounterparties(projectId),
    listLedgerTypes(projectId),
    listApprovalStatuses(projectId),
    listContractTags(projectId),
    resolveDefaultStatusIdAction(projectId),
  ]);

  if (!counterparty) notFound();

  const contracts = allContracts.filter(
    (c) => c.counterpartyId === counterpartyId,
  );
  const certificates = allCertificates.filter(
    (a) => a.counterpartyId === counterpartyId,
  );
  const payments = allPayments.filter(
    (p) => p.counterpartyId === counterpartyId,
  );

  const defaultStatusId =
    ("id" in statusRes && statusRes.id) || statuses[0]?.id || "";

  return (
    <CounterpartyDetailView
      projectId={projectId}
      locale={locale}
      counterparty={counterparty}
      contracts={contracts}
      certificates={certificates}
      companies={companies.map((c) => ({ id: c.id, name: c.name }))}
      counterparties={counterparties.map((c) => ({ id: c.id, name: c.name }))}
      ledgerTypes={ledgerTypes.map((t) => ({ id: t.id, name: t.name }))}
      contractOptions={allContracts.map((c) => ({
        id: c.id,
        number: c.number,
        companyId: c.companyId,
        counterpartyId: c.counterpartyId,
      }))}
      payments={payments.map((p) => ({
        id: p.id,
        date: p.date,
        amountWithTax: Number(p.amountWithTax),
        comment: p.comment,
        companyId: p.companyId,
        counterpartyId: p.counterpartyId,
        contractId: p.contractId,
      }))}
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
