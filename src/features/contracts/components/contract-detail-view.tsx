"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ContractFileRole } from "@prisma/client";
import {
  attachContractFileAction,
  deleteContractAction,
  detachContractFileAction,
  updateContractFileRoleAction,
} from "@/features/contracts/actions";
import {
  CertificateFormModal,
} from "@/features/contracts/components/certificate-form-modal";
import {
  ContractFormModal,
  type ContractFormDefaults,
} from "@/features/contracts/components/contract-form-modal";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";

type ContractDetail = NonNullable<
  Awaited<ReturnType<typeof import("@/features/contracts/queries").getContract>>
>;

function money(n: number | string | { toString(): string } | null | undefined) {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : Number(n.toString());
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2 });
}

export function ContractDetailView({
  projectId,
  locale,
  contract,
  companies,
  counterparties,
  ledgerTypes,
  statuses,
  existingTags,
  defaultStatusId,
  canWrite,
}: {
  projectId: string;
  locale: string;
  contract: ContractDetail;
  companies: { id: string; name: string }[];
  counterparties: { id: string; name: string }[];
  ledgerTypes: { id: string; name: string }[];
  statuses: { id: string; name: string; color: string }[];
  existingTags: string[];
  defaultStatusId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [actOpen, setActOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  const editDefaults: ContractFormDefaults = {
    id: contract.id,
    date: new Date(contract.date).toISOString().slice(0, 10),
    number: contract.number,
    companyId: contract.companyId,
    counterpartyId: contract.counterpartyId,
    ledgerTypeId: contract.ledgerTypeId,
    amount: Number(contract.amount),
    vatEnabled: contract.vatEnabled,
    vatRate: contract.vatRate != null ? Number(contract.vatRate) : 22,
    vatAmount:
      contract.vatAmount != null ? Number(contract.vatAmount) : null,
    isPreliminary: contract.isPreliminary,
    statusId: contract.statusId,
    tags: contract.tags,
    summary: contract.summary,
    comment: contract.comment,
    creditsName: contract.creditsName,
  };

  async function onUpload(file: File, role: ContractFileRole) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/uploads/file`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Ошибка загрузки");
      await attachContractFileAction(projectId, contract.id, data.id, role);
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] pb-4">
        <Link
          href={`/${locale}/projects/${projectId}/counterparties/contracts`}
          className="glass-btn-secondary inline-flex rounded-xl px-4 py-2.5 text-sm"
        >
          ← К списку
        </Link>
        <h1 className="font-display text-xl font-semibold">
          Договор {contract.number}
        </h1>
        <Badge
          style={{
            backgroundColor: `${contract.status.color}33`,
            borderColor: `${contract.status.color}66`,
            color: contract.status.color,
          }}
          className="border"
        >
          {contract.status.name}
        </Badge>
        {contract.isPreliminary ? (
          <span className="text-xs text-[var(--muted-fg)]">
            предварительная сумма
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-2">
          {canWrite ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
                Редактировать
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => {
                  if (!confirm("Удалить договор?")) return;
                  startTransition(async () => {
                    await deleteContractAction(projectId, contract.id);
                    router.push(
                      `/${locale}/projects/${projectId}/counterparties/contracts`,
                    );
                  });
                }}
              >
                Удалить
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs text-[var(--muted-fg)]">Дата</dt>
              <dd>{formatDateShort(contract.date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-fg)]">Номер</dt>
              <dd>{contract.number}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-fg)]">Компания</dt>
              <dd>{contract.company.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-fg)]">Контрагент</dt>
              <dd>
                <Link
                  href={`/${locale}/projects/${projectId}/counterparties/${contract.counterpartyId}`}
                  className="text-[var(--accent)] hover:underline"
                >
                  {contract.counterparty.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-fg)]">Ведомость</dt>
              <dd>{contract.ledgerType?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-fg)]">Сумма / с НДС</dt>
              <dd>
                {money(contract.amount)} / {money(contract.amountWithVat)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--muted-fg)]">Содержание</dt>
              <dd className="whitespace-pre-wrap">{contract.summary || "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-[var(--muted-fg)]">Примечание</dt>
              <dd className="whitespace-pre-wrap">{contract.comment || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-fg)]">Для титров</dt>
              <dd>{contract.creditsName || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-fg)]">Теги</dt>
              <dd>{contract.tags.join(", ") || "—"}</dd>
            </div>
          </dl>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
            <h3 className="font-semibold">Файлы</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {contract.files.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-2 py-1.5"
                >
                  <a
                    href={f.file.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-[var(--accent)] hover:underline"
                  >
                    {f.file.originalName}
                  </a>
                  {canWrite ? (
                    <Select
                      value={f.role}
                      onChange={(e) => {
                        void updateContractFileRoleAction(
                          projectId,
                          contract.id,
                          f.id,
                          e.target.value as ContractFileRole,
                        ).then(() => router.refresh());
                      }}
                    >
                      <option value="OTHER">Прочее</option>
                      <option value="SCAN">Скан</option>
                      <option value="ORIGINAL">Оригинал</option>
                    </Select>
                  ) : (
                    <span className="text-xs text-[var(--muted-fg)]">{f.role}</span>
                  )}
                  {canWrite ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        void detachContractFileAction(
                          projectId,
                          contract.id,
                          f.id,
                        ).then(() => router.refresh());
                      }}
                    >
                      ×
                    </Button>
                  ) : null}
                </li>
              ))}
              {contract.files.length === 0 ? (
                <li className="text-[var(--muted-fg)]">Нет файлов</li>
              ) : null}
            </ul>
            {canWrite ? (
              <div className="mt-3 space-y-2">
                <Label>Загрузить</Label>
                <Input
                  type="file"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onUpload(file, "OTHER");
                    e.target.value = "";
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={uploading}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.onchange = () => {
                        const file = input.files?.[0];
                        if (file) void onUpload(file, "SCAN");
                      };
                      input.click();
                    }}
                  >
                    + Скан
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={uploading}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.onchange = () => {
                        const file = input.files?.[0];
                        if (file) void onUpload(file, "ORIGINAL");
                      };
                      input.click();
                    }}
                  >
                    + Оригинал
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Платежи и начисления</h3>
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs text-[var(--muted-fg)]">Кассовые платежи</p>
            <ul className="mt-2 space-y-1 text-sm">
              {contract.cashPayments.map((p) => (
                <li key={p.id}>
                  {formatDateShort(p.date)} · {money(p.amountWithTax)}
                  {p.comment ? ` — ${p.comment}` : ""}
                </li>
              ))}
              {contract.cashPayments.length === 0 ? (
                <li className="text-[var(--muted-fg)]">Нет привязанных платежей</li>
              ) : null}
            </ul>
          </div>
          <div>
            <p className="text-xs text-[var(--muted-fg)]">Начисления</p>
            <ul className="mt-2 space-y-1 text-sm">
              {contract.accruals.map((p) => (
                <li key={p.id}>
                  {formatDateShort(p.date)} · {money(p.amountWithTax)}
                  {p.comment ? ` — ${p.comment}` : ""}
                </li>
              ))}
              {contract.accruals.length === 0 ? (
                <li className="text-[var(--muted-fg)]">Нет привязанных начислений</li>
              ) : null}
            </ul>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Акты</h3>
          {canWrite ? (
            <Button type="button" onClick={() => setActOpen(true)}>
              Добавить акт
            </Button>
          ) : null}
        </div>
        <ul className="mt-3 space-y-2 text-sm">
          {contract.certificates.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
            >
              <span>
                {formatDateShort(a.date)} · № {a.number} ·{" "}
                {money(a.amountWithVat)}
                {a.payment
                  ? ` · платёж ${formatDateShort(a.payment.date)}`
                  : ""}
                {a.files.length ? ` · файлов: ${a.files.length}` : ""}
              </span>
              <Badge
                className="border"
                style={{
                  backgroundColor: `${a.status.color}33`,
                  borderColor: `${a.status.color}66`,
                  color: a.status.color,
                }}
              >
                {a.status.name}
              </Badge>
            </li>
          ))}
          {contract.certificates.length === 0 ? (
            <li className="text-[var(--muted-fg)]">Актов пока нет</li>
          ) : null}
        </ul>
      </section>

      {canWrite ? (
        <>
          <ContractFormModal
            projectId={projectId}
            locale={locale}
            open={editOpen}
            onClose={() => {
              setEditOpen(false);
              router.refresh();
            }}
            companies={companies}
            counterparties={counterparties}
            ledgerTypes={ledgerTypes}
            statuses={statuses}
            existingTags={existingTags}
            defaults={editDefaults}
            defaultStatusId={defaultStatusId}
          />
          <CertificateFormModal
            projectId={projectId}
            open={actOpen}
            onClose={() => {
              setActOpen(false);
              router.refresh();
            }}
            companies={companies}
            counterparties={counterparties}
            contracts={[
              {
                id: contract.id,
                number: contract.number,
                companyId: contract.companyId,
                counterpartyId: contract.counterpartyId,
              },
            ]}
            payments={contract.cashPayments.map((p) => ({
              id: p.id,
              date: p.date,
              amountWithTax: Number(p.amountWithTax),
              comment: p.comment,
              companyId: contract.companyId,
              counterpartyId: contract.counterpartyId,
              contractId: contract.id,
            }))}
            statuses={statuses}
            defaultStatusId={defaultStatusId}
            defaults={{
              companyId: contract.companyId,
              counterpartyId: contract.counterpartyId,
              contractId: contract.id,
              amount: Number(contract.amount),
              statusId: defaultStatusId,
            }}
            lockCompany
            lockCounterparty
            lockContract
          />
        </>
      ) : null}
    </div>
  );
}
