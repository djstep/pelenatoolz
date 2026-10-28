"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ContractFormModal,
  type ContractFormDefaults,
} from "@/features/contracts/components/contract-form-modal";
import { CertificatesWorkspace } from "@/features/contracts/components/certificates-workspace";
import type { ContractFinanceAccess } from "@/features/contracts/lib/finance-access";
import type {
  CertificateListItem,
  ContractListItem,
} from "@/features/contracts/queries";
import { counterpartyTypeLabels } from "@/features/counterparties/labels";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Badge, statusBadgeStyle } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

function money(n: number | string | { toString(): string } | null | undefined) {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : Number(n.toString());
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2 });
}

export function CounterpartyDetailView({
  projectId,
  locale,
  counterparty,
  contracts,
  certificates,
  companies,
  counterparties,
  ledgerTypes,
  contractOptions,
  payments,
  statuses,
  existingTags,
  defaultStatusId,
  showContracts,
  canWrite,
  finance,
  canCreateParties,
}: {
  projectId: string;
  locale: string;
  counterparty: {
    id: string;
    name: string;
    type: keyof typeof counterpartyTypeLabels;
    contacts: string | null;
    inn: string | null;
    notes: string | null;
  };
  contracts: ContractListItem[];
  certificates: CertificateListItem[];
  companies: { id: string; name: string }[];
  counterparties: { id: string; name: string }[];
  ledgerTypes: { id: string; name: string }[];
  contractOptions: {
    id: string;
    number: string;
    companyId: string;
    counterpartyId: string;
  }[];
  payments: {
    id: string;
    date: string | Date;
    amountWithTax: number | string;
    comment: string | null;
    companyId: string;
    counterpartyId: string;
    contractId: string | null;
  }[];
  statuses: { id: string; name: string; color: string }[];
  existingTags: string[];
  defaultStatusId: string;
  /** Право просмотра договоров и актов; без него блоки договоров и актов скрыты. */
  showContracts: boolean;
  /** Право изменения договоров и актов. */
  canWrite: boolean;
  finance: ContractFinanceAccess;
  canCreateParties: boolean;
}) {
  const router = useRouter();
  const [contractOpen, setContractOpen] = useState(false);
  const [prefill, setPrefill] = useState<ContractFormDefaults | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] pb-4">
        <Link
          href={`/${locale}/projects/${projectId}/counterparties`}
          className="glass-btn-secondary inline-flex rounded-xl px-4 py-2.5 text-sm"
        >
          ← Справочник
        </Link>
        <div>
          <h1 className="font-display text-xl font-semibold">
            {counterparty.name}
          </h1>
          <p className="text-sm text-[var(--muted-fg)]">
            {counterpartyTypeLabels[counterparty.type]}
            {counterparty.inn ? ` · ИНН ${counterparty.inn}` : ""}
          </p>
        </div>
      </header>

      <dl className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--muted-fg)]">Контакты</dt>
          <dd>{counterparty.contacts || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted-fg)]">Заметки</dt>
          <dd>{counterparty.notes || "—"}</dd>
        </div>
      </dl>

      {showContracts ? (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">Договоры</h2>
              <div className="flex gap-2">
                <Link
                  href={`/${locale}/projects/${projectId}/counterparties/contracts?counterpartyId=${counterparty.id}`}
                  className="text-sm text-[var(--accent)] hover:underline"
                >
                  Все договоры →
                </Link>
                {canWrite ? (
                  <Button
                    type="button"
                    onClick={() => {
                      setPrefill({
                        counterpartyId: counterparty.id,
                        statusId: defaultStatusId,
                      });
                      setContractOpen(true);
                    }}
                  >
                    Добавить
                  </Button>
                ) : null}
              </div>
            </div>
            <ul className="divide-y divide-[var(--border)]/60 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
              {contracts.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/${locale}/projects/${projectId}/counterparties/contracts/${c.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-[rgb(var(--tint-rgb)/0.03)]"
                  >
                    <span>
                      {formatDateShort(c.date)} · № {c.number}
                      {finance.read ? ` · ${money(c.amountWithVat)}` : ""}
                    </span>
                    <Badge
                      className="status-badge"
                      style={statusBadgeStyle(c.status.color)}
                    >
                      {c.status.name}
                    </Badge>
                  </Link>
                </li>
              ))}
              {contracts.length === 0 ? (
                <li className="px-4 py-6 text-sm text-[var(--muted-fg)]">
                  Договоров с этим контрагентом пока нет
                </li>
              ) : null}
            </ul>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold">Акты</h2>
              <Link
                href={`/${locale}/projects/${projectId}/counterparties/acts?counterpartyId=${counterparty.id}`}
                className="text-sm text-[var(--accent)] hover:underline"
              >
                Все акты →
              </Link>
            </div>
            <CertificatesWorkspace
              projectId={projectId}
              certificates={certificates}
              companies={companies}
              counterparties={counterparties}
              contracts={contractOptions}
              payments={payments}
              statuses={statuses}
              defaultStatusId={defaultStatusId}
              canWrite={canWrite}
              finance={finance}
              canCreateParties={canCreateParties}
              initialCounterpartyId={counterparty.id}
            />
          </section>
        </>
      ) : null}

      {showContracts && canWrite ? (
        <ContractFormModal
          projectId={projectId}
          locale={locale}
          open={contractOpen}
          onClose={() => {
            setContractOpen(false);
            router.refresh();
          }}
          companies={companies}
          counterparties={counterparties}
          ledgerTypes={ledgerTypes}
          statuses={statuses}
          existingTags={existingTags}
          defaults={prefill}
          defaultStatusId={defaultStatusId}
          finance={finance}
          canCreateParties={canCreateParties}
        />
      ) : null}
    </div>
  );
}
