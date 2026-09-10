import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveDefaultStatusIdAction } from "@/features/contracts/actions";
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
import { getCashPayment } from "@/features/payments/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { formatDateShort } from "@/shared/i18n/format-date";

type Props = {
  params: Promise<{ locale: string; projectId: string; paymentId: string }>;
};

function money(n: number | string | { toString(): string } | null | undefined) {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : Number(n.toString());
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2 });
}

export default async function PaymentDetailPage({ params }: Props) {
  const { locale, projectId, paymentId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const [
    payment,
    allCertificates,
    companies,
    counterparties,
    contracts,
    payments,
    statuses,
    statusRes,
  ] = await Promise.all([
    getCashPayment(projectId, paymentId),
    listCertificates(projectId),
    listCompanies(projectId),
    listCounterparties(projectId),
    listContracts(projectId),
    listPaymentsForCertificateForm(projectId),
    listApprovalStatuses(projectId),
    resolveDefaultStatusIdAction(projectId),
  ]);

  if (!payment) notFound();

  const defaultStatusId =
    ("id" in statusRes && statusRes.id) || statuses[0]?.id || "";
  const certificateRows = allCertificates.filter(
    (c) => c.paymentId === paymentId,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] pb-4">
        <Link
          href={`/${locale}/projects/${projectId}/payments`}
          className="glass-btn-secondary inline-flex rounded-xl px-4 py-2.5 text-sm"
        >
          ← К платежам
        </Link>
        <div>
          <h1 className="font-display text-xl font-semibold">
            Платёж {formatDateShort(payment.date)}
          </h1>
          <p className="text-sm text-[var(--muted-fg)]">
            {payment.counterparty.name} · {payment.company.name} ·{" "}
            {money(payment.amountWithTax)}
          </p>
        </div>
      </header>

      <dl className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--muted-fg)]">Сумма / с налогом</dt>
          <dd>
            {money(payment.amount)} / {money(payment.amountWithTax)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted-fg)]">Комментарий</dt>
          <dd>{payment.comment || "—"}</dd>
        </div>
        {payment.contractId ? (
          <div>
            <dt className="text-xs text-[var(--muted-fg)]">Договор</dt>
            <dd>
              <Link
                href={`/${locale}/projects/${projectId}/counterparties/contracts/${payment.contractId}`}
                className="text-[var(--accent)] hover:underline"
              >
                {payment.contract?.number ?? "Открыть договор"}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Акты</h2>
        <CertificatesWorkspace
          projectId={projectId}
          certificates={certificateRows}
          companies={companies.map((c) => ({ id: c.id, name: c.name }))}
          counterparties={counterparties.map((c) => ({
            id: c.id,
            name: c.name,
          }))}
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
          canWrite={ctx.can("finance:write")}
          initialCompanyId={payment.companyId}
          initialCounterpartyId={payment.counterpartyId}
          initialContractId={payment.contractId ?? undefined}
          initialPaymentId={payment.id}
        />
      </section>
    </div>
  );
}
