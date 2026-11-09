"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSafeActionState } from "@/shared/ui/forms/use-safe-action-state";
import { useCounterpartyTaxDefault } from "@/features/contracts/components/use-counterparty-tax-default";
import { useRouter } from "next/navigation";
import {
  attachCertificateFileAction,
  createCertificateAction,
  deleteCertificateAction,
  updateCertificateAction,
  type ContractsActionState,
} from "@/features/contracts/actions";
import type { ContractFinanceAccess } from "@/features/contracts/lib/finance-access";
import {
  computeContractVat,
  vatManualInput,
  vatRateInput,
} from "@/features/contracts/lib/vat";
import {
  EntityPicker,
  mergePickerOptions,
  type PickerOption,
} from "@/features/counterparties/components/entity-picker";
import {
  quickCreateCompanyAction,
  quickCreateCounterpartyAction,
} from "@/features/counterparties/actions";
import { formatDateShort } from "@/shared/i18n/format-date";
import { uploadProjectFile } from "@/features/files/lib/upload-client";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { toast, useActionToast } from "@/shared/ui/toast";
import { useOnChange } from "@/shared/hooks/use-on-change";

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
  vatAmount?: number | null;
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
  finance,
  canCreateParties,
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
  /** Без права менять финансы суммы и платёж скрыты, сервер их не принимает. */
  finance: ContractFinanceAccess;
  /** Новые компании и контрагенты добавляются в справочник «Финансов». */
  canCreateParties: boolean;
}) {
  const isEdit = Boolean(defaults?.id);
  const bound = isEdit
    ? updateCertificateAction.bind(null, projectId, defaults!.id!)
    : createCertificateAction.bind(null, projectId);
  const [state, action, pending] = useSafeActionState(bound, initial);
  useActionToast(state);
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = useConfirm();

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
  const [vatRate, setVatRate] = useState(() => vatRateInput(defaults?.vatRate));
  const [vatManual, setVatManual] = useState(() => vatManualInput(defaults));
  const [uploading, setUploading] = useState(false);
  const effectiveVatRate = vatRate.trim();
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Новый акт: налог по умолчанию — из формы оплаты, сопоставленной типу контрагента.
  // Подставляется при выборе контрагента; в заготовке «На основе» налог уже задан — не трогаем.
  const autoTax = !isEdit && finance.write;
  const taxDefault = useCounterpartyTaxDefault(projectId, (fields) => {
    setVatEnabled(fields.vatEnabled);
    setVatRate(fields.vatRate);
    setVatManual(fields.vatManual);
  });
  function chooseCounterparty(id: string) {
    setCounterpartyId(id);
    if (autoTax && id !== counterpartyId) taxDefault.request(id);
  }
  const presetCounterpartyId = defaults?.counterpartyId ?? "";
  const presetHasTax = defaults?.vatEnabled !== undefined;
  useEffect(() => {
    // Окно открыли или закрыли: ответ на прежний запрос уже не к месту.
    taxDefault.cancel();
    if (open && autoTax && !presetHasTax && presetCounterpartyId) {
      taxDefault.request(presetCounterpartyId);
    }
  }, [open, autoTax, presetHasTax, presetCounterpartyId, taxDefault]);

  // Поля сбрасываются только при открытии окна. Новые списки с сервера (после быстрого
  // добавления компании или контрагента) дополняют варианты, выбранное остаётся.
  const [wasOpen, setWasOpen] = useState(open);
  const [lists, setLists] = useState({ companies, counterparties });
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCompanyOpts(companies);
      setCpOpts(counterparties);
      setCompanyId(defaults?.companyId ?? "");
      setCounterpartyId(defaults?.counterpartyId ?? "");
      setContractId(defaults?.contractId ?? "");
      setPaymentId(defaults?.paymentId ?? "");
      setStatusId(defaults?.statusId ?? defaultStatusId);
      setAmount(String(defaults?.amount ?? ""));
      setVatEnabled(defaults?.vatEnabled ?? false);
      setVatRate(vatRateInput(defaults?.vatRate));
      setVatManual(vatManualInput(defaults));
      setPendingFile(null);
    }
  }
  if (lists.companies !== companies || lists.counterparties !== counterparties) {
    setLists({ companies, counterparties });
    setCompanyOpts((prev) => mergePickerOptions(companies, prev));
    setCpOpts((prev) => mergePickerOptions(counterparties, prev));
  }

  // Каждый ответ сервера обрабатываем один раз: иначе «успех» остаётся в состоянии,
  // и окно закрывается (а файл грузится) снова при каждой отрисовке родителя.
  const handledState = useRef(state);
  useEffect(() => {
    if (handledState.current === state) return;
    handledState.current = state;
    if (state.success) {
      const certId = state.certificateId ?? state.actId;
      if (certId && pendingFile) {
        void (async () => {
          setUploading(true);
          try {
            const res = await uploadProjectFile(projectId, "file", pendingFile, "contract");
            const data = (await res.json()) as { id?: string };
            if (data.id) {
              const attached = await attachCertificateFileAction(
                projectId,
                certId,
                data.id,
                "SCAN",
              );
              if (attached.error) toast.error(attached.error);
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
  }, [state, pendingFile, projectId, onClose]);

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

  useOnChange([filteredPayments, paymentId, lockPayment], () => {
    if (paymentId && !filteredPayments.some((p) => p.id === paymentId)) {
      if (!lockPayment) setPaymentId("");
    }
  });

  useOnChange([filteredContracts, contractId, lockContract], () => {
    if (contractId && !filteredContracts.some((c) => c.id === contractId)) {
      if (!lockContract) setContractId("");
    }
  });

  const vatPreview = useMemo(() => {
    const amt = Number(amount) || 0;
    const manual = vatManual.trim() ? Number(vatManual) : null;
    return computeContractVat({
      amount: amt,
      vatEnabled,
      vatRate: effectiveVatRate === "" ? null : Number(effectiveVatRate) || 0,
      vatAmountManual: Number.isFinite(manual as number) ? manual : null,
    });
  }, [amount, vatEnabled, effectiveVatRate, vatManual]);

  return (
    <Modal
      guardUnsaved
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
          <Button
            type="button"
            variant="secondary"
            data-modal-cancel
            onClick={onClose}
          >
            Отмена
          </Button>
          {isEdit ? (
            <Button
              type="button"
              variant="danger"
              className="ml-auto"
              disabled={pending || uploading || deleting}
              onClick={() =>
                void confirmDelete({
                  title: defaults?.number ? `Удалить акт № ${defaults.number}?` : "Удалить акт?",
                  details: ["Файлы акта удалятся."],
                  action: async () => {
                    setDeleting(true);
                    try {
                      const res = await deleteCertificateAction(projectId, defaults!.id!);
                      if (res.error) return res.error;
                      toast.success(res.success ?? "Акт удалён");
                      onClose();
                      router.refresh();
                    } finally {
                      setDeleting(false);
                    }
                  },
                })
              }
            >
              {deleting ? "…" : "Удалить"}
            </Button>
          ) : null}
          {state.error ? (
            <span className="w-full text-sm text-[var(--danger)]">
              {state.error}
            </span>
          ) : null}
        </div>
      }
    >
      <form id="certificate-form" onSubmit={submitKeepingFields(action)} className="space-y-4">
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
            onQuickCreate={
              canCreateParties
                ? async (fd) => {
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
                  }
                : undefined
            }
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
              chooseCounterparty(id);
              if (!lockContract) setContractId("");
              if (!lockPayment) setPaymentId("");
            }}
            onQuickCreate={
              canCreateParties
                ? async (fd) => {
                    const r = await quickCreateCounterpartyAction(
                      projectId,
                      String(fd.get("name") ?? ""),
                    );
                    if ("id" in r) {
                      setCpOpts((p) =>
                        p.some((x) => x.id === r.id) ? p : [...p, r],
                      );
                      chooseCounterparty(r.id);
                    }
                    return r;
                  }
                : undefined
            }
          />
        ) : (
          <input type="hidden" name="counterpartyId" value={counterpartyId} />
        )}

        <div>
          <Label htmlFor="contractId">Договор</Label>
          {/* Заблокированный список браузер не отправляет — значение уходит скрытым полем. */}
          {lockContract ? (
            <input type="hidden" name="contractId" value={contractId} />
          ) : null}
          <Select
            id="contractId"
            name={lockContract ? undefined : "contractId"}
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

        {finance.write ? (
          <>
            <div>
              <Label htmlFor="paymentId">Платёж</Label>
              {lockPayment ? (
                <input type="hidden" name="paymentId" value={paymentId} />
              ) : null}
              <Select
                id="paymentId"
                name={lockPayment ? undefined : "paymentId"}
                value={paymentId}
                disabled={lockPayment}
                onChange={(e) => {
                  const id = e.target.value;
                  setPaymentId(id);
                  const p = payments.find((x) => x.id === id);
                  if (p) {
                    setCompanyId(p.companyId);
                    chooseCounterparty(p.counterpartyId);
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
                <Label htmlFor="amount">Сумма (без налога) *</Label>
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
                С налогом
              </label>
            </div>

            {vatEnabled ? (
              <div className="grid gap-3 rounded-xl border border-[var(--border)] p-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor="vatRate">Ставка налога, %</Label>
                  <Input
                    id="vatRate"
                    name="vatRate"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="%"
                    value={vatRate}
                    onChange={(e) => {
                      setVatRate(e.target.value);
                      setVatManual("");
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="vatAmountManual">Налог вручную</Label>
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
                  <Label>Итого с налогом</Label>
                  <p className="mt-2 text-lg font-semibold tabular-nums">
                    {vatPreview.amountWithVat.toLocaleString("ru-RU", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>
              </div>
            ) : null}
          </>
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
