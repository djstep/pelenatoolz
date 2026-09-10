"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  attachCertificateFileAction,
  createCertificateAction,
  updateCertificateAction,
  type ContractsActionState,
} from "@/features/contracts/actions";
import {
  VAT_RATE_PRESETS,
  computeContractVat,
} from "@/features/contracts/lib/vat";
import {
  EntityPicker,
  type PickerOption,
} from "@/features/counterparties/components/entity-picker";
import {
  quickCreateCompanyAction,
  quickCreateCounterpartyAction,
} from "@/features/counterparties/actions";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useActionToast } from "@/shared/ui/toast";

const initial: ContractsActionState = {};

export type CertificateFormDefaults = {
  id?: string;
  date?: string;
  number?: string;
  companyId?: string;
  counterpartyId?: string;
  contractId?: string | null;
  paymentId?: string | null;
  amount?: number;
  vatEnabled?: boolean;
  vatRate?: number | null;
  statusId?: string;
  summary?: string | null;
  comment?: string | null;
};

type ContractOpt = {
  id: string;
  number: string;
  companyId: string;
  counterpartyId: string;
};

type PaymentOpt = {
  id: string;
  date: string | Date;
  amountWithTax: number | string;
  comment: string | null;
  companyId: string;
  counterpartyId: string;
  contractId: string | null;
};

function toDateInput(value?: string | Date | null) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function moneyLabel(n: number | string) {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v)
    ? v.toLocaleString("ru-RU", { minimumFractionDigits: 2 })
    : String(n);
}

export function CertificateFormModal({
  projectId,
  open,
  onClose,
  companies,
  counterparties,
  contracts,
  payments,
  statuses,
  defaults,
  defaultStatusId,
  lockCompany = false,
  lockCounterparty = false,
  lockContract = false,
  lockPayment = false,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  companies: PickerOption[];
  counterparties: PickerOption[];
  contracts: ContractOpt[];
  payments: PaymentOpt[];
  statuses: { id: string; name: string; color: string }[];
  defaults?: CertificateFormDefaults | null;
  defaultStatusId: string;
  lockCompany?: boolean;
  lockCounterparty?: boolean;
  lockContract?: boolean;
  lockPayment?: boolean;
}) {
  const isEdit = Boolean(defaults?.id);
  const bound = isEdit
    ? updateCertificateAction.bind(null, projectId, defaults!.id!)
    : createCertificateAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);

  const [companyOpts, setCompanyOpts] = useState(companies);
  const [cpOpts, setCpOpts] = useState(counterparties);
  const [companyId, setCompanyId] = useState(defaults?.companyId ?? "");
  const [counterpartyId, setCounterpartyId] = useState(
    defaults?.counterpartyId ?? "",
  );
  const [contractId, setContractId] = useState(defaults?.contractId ?? "");
  const [paymentId, setPaymentId] = useState(defaults?.paymentId ?? "");
  const [statusId, setStatusId] = useState(
    defaults?.statusId ?? defaultStatusId,
  );
  const [amount, setAmount] = useState(String(defaults?.amount ?? ""));
  const [vatEnabled, setVatEnabled] = useState(defaults?.vatEnabled ?? false);
  const [vatRate, setVatRate] = useState(String(defaults?.vatRate ?? 22));
  const [vatManual, setVatManual] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setCompanyOpts(companies);
    setCpOpts(counterparties);
    setCompanyId(defaults?.companyId ?? "");
    setCounterpartyId(defaults?.counterpartyId ?? "");
    setContractId(defaults?.contractId ?? "");
    setPaymentId(defaults?.paymentId ?? "");
    setStatusId(defaults?.statusId ?? defaultStatusId);
    setAmount(String(defaults?.amount ?? ""));
    setVatEnabled(defaults?.vatEnabled ?? false);
    setVatRate(String(defaults?.vatRate ?? 22));
    setVatManual("");
    setPendingFile(null);
  }, [open, defaults, companies, counterparties, defaultStatusId]);

  useEffect(() => {
    if (state.success) {
      const certId = state.certificateId ?? state.actId;
      if (certId && pendingFile) {
        void (async () => {
          setUploading(true);
          try {
            const fd = new FormData();
            fd.append("file", pendingFile);
            const res = await fetch(`/api/projects/${projectId}/uploads/file`, {
              method: "POST",
              body: fd,
            });
            const data = (await res.json()) as { id?: string };
            if (data.id) {
              await attachCertificateFileAction(
                projectId,
                certId,
                data.id,
                "SCAN",
              );
            }
          } finally {
            setUploading(false);
            onClose();
          }
        })();
      } else {
        onClose();
      }
    }
  }, [state.success, state.certificateId, state.actId, pendingFile, projectId, onClose]);

  const filteredContracts = useMemo(
    () =>
      contracts.filter(
        (c) =>
          (!companyId || c.companyId === companyId) &&
          (!counterpartyId || c.counterpartyId === counterpartyId),
      ),
    [contracts, companyId, counterpartyId],
  );

  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      if (contractId) return p.contractId === contractId;
      return (
        (!companyId || p.companyId === companyId) &&
        (!counterpartyId || p.counterpartyId === counterpartyId)
      );
    });
  }, [payments, contractId, companyId, counterpartyId]);

  useEffect(() => {
    if (paymentId && !filteredPayments.some((p) => p.id === paymentId)) {
      if (!lockPayment) setPaymentId("");
    }
  }, [filteredPayments, paymentId, lockPayment]);

  useEffect(() => {
    if (contractId && !filteredContracts.some((c) => c.id === contractId)) {
      if (!lockContract) setContractId("");
    }
  }, [filteredContracts, contractId, lockContract]);

  const vatPreview = useMemo(() => {
    const amt = Number(amount) || 0;
    const manual = vatManual.trim() ? Number(vatManual) : null;
    return computeContractVat({
      amount: amt,
      vatEnabled,
      vatRate: Number(vatRate) || 22,
      vatAmountManual: Number.isFinite(manual as number) ? manual : null,
    });
  }, [amount, vatEnabled, vatRate, vatManual]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Редактирование акта" : "Новый акт"}
      wide
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            form="certificate-form"
            disabled={pending || uploading}
          >
            {pending || uploading ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          {state.error ? (
            <span className="w-full text-sm text-[var(--danger)]">
              {state.error}
            </span>
          ) : null}
        </div>
      }
    >
      <form id="certificate-form" action={action} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="cert-number">Номер *</Label>
            <Input
              id="cert-number"
              name="number"
              required
              defaultValue={defaults?.number ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="cert-date">Дата *</Label>
            <Input
              id="cert-date"
              name="date"
              type="date"
              required
              defaultValue={toDateInput(defaults?.date)}
            />
          </div>
        </div>

        {!lockCompany ? (
          <EntityPicker
            name="companyId"
            label="Компания *"
            options={companyOpts}
            value={companyId}
            onChange={(id) => {
              setCompanyId(id);
              if (!lockContract) setContractId("");
              if (!lockPayment) setPaymentId("");
            }}
            onQuickCreate={async (fd) => {
              const r = await quickCreateCompanyAction(
                projectId,
                String(fd.get("name") ?? ""),
              );
              if ("id" in r) {
                setCompanyOpts((p) =>
                  p.some((x) => x.id === r.id) ? p : [...p, r],
                );
                setCompanyId(r.id);
              }
              return r;
            }}
          />
        ) : (
          <input type="hidden" name="companyId" value={companyId} />
        )}

        {!lockCounterparty ? (
          <EntityPicker
            name="counterpartyId"
            label="Контрагент *"
            options={cpOpts}
            value={counterpartyId}
            onChange={(id) => {
              setCounterpartyId(id);
              if (!lockContract) setContractId("");
              if (!lockPayment) setPaymentId("");
            }}
            onQuickCreate={async (fd) => {
              const r = await quickCreateCounterpartyAction(
                projectId,
                String(fd.get("name") ?? ""),
              );
              if ("id" in r) {
                setCpOpts((p) =>
                  p.some((x) => x.id === r.id) ? p : [...p, r],
                );
                setCounterpartyId(r.id);
              }
              return r;
            }}
          />
        ) : (
          <input type="hidden" name="counterpartyId" value={counterpartyId} />
        )}

        <div>
          <Label htmlFor="contractId">Договор</Label>
          <Select
            id="contractId"
            name="contractId"
            value={contractId}
            disabled={lockContract}
            onChange={(e) => {
              setContractId(e.target.value);
              if (!lockPayment) setPaymentId("");
            }}
          >
            <option value="">—</option>
            {filteredContracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="paymentId">Платёж</Label>
          <Select
            id="paymentId"
            name="paymentId"
            value={paymentId}
            disabled={lockPayment}
            onChange={(e) => {
              const id = e.target.value;
              setPaymentId(id);
              const p = payments.find((x) => x.id === id);
              if (p) {
                setCompanyId(p.companyId);
                setCounterpartyId(p.counterpartyId);
                if (p.contractId) setContractId(p.contractId);
              }
            }}
          >
            <option value="">—</option>
            {filteredPayments.map((p) => (
              <option key={p.id} value={p.id}>
                {formatDateShort(p.date)} · {moneyLabel(p.amountWithTax)}
                {p.comment ? ` — ${p.comment}` : ""}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="amount">Сумма (без НДС) *</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              step="0.01"
              min={0}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              name="vatEnabled"
              checked={vatEnabled}
              onChange={(e) => setVatEnabled(e.target.checked)}
            />
            С НДС
          </label>
        </div>

        {vatEnabled ? (
          <div className="grid gap-3 rounded-xl border border-[var(--border)] p-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="vatRate">Ставка %</Label>
              <Select
                id="vatRate"
                name="vatRate"
                value={vatRate}
                onChange={(e) => {
                  setVatRate(e.target.value);
                  setVatManual("");
                }}
              >
                {VAT_RATE_PRESETS.map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="vatAmountManual">НДС вручную</Label>
              <Input
                id="vatAmountManual"
                name="vatAmountManual"
                type="number"
                step="0.01"
                value={vatManual}
                onChange={(e) => setVatManual(e.target.value)}
                placeholder="авто"
              />
            </div>
            <div>
              <Label>Итого с НДС</Label>
              <p className="mt-2 text-lg font-semibold tabular-nums">
                {vatPreview.amountWithVat.toLocaleString("ru-RU", {
                  minimumFractionDigits: 2,
                })}
              </p>
            </div>
          </div>
        ) : null}

        <div>
          <Label htmlFor="statusId">Статус</Label>
          <Select
            id="statusId"
            name="statusId"
            required
            value={statusId}
            onChange={(e) => setStatusId(e.target.value)}
          >
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="summary">Содержание</Label>
          <Input
            id="summary"
            name="summary"
            defaultValue={defaults?.summary ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="comment">Примечание</Label>
          <Input
            id="comment"
            name="comment"
            defaultValue={defaults?.comment ?? ""}
          />
        </div>

        {!isEdit ? (
          <div>
            <Label htmlFor="cert-file">Скан / Word акта</Label>
            <Input
              id="cert-file"
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
            />
          </div>
        ) : (
          <div>
            <Label htmlFor="cert-file-edit">Добавить файл</Label>
            <Input
              id="cert-file-edit"
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}
      </form>
    </Modal>
  );
}
