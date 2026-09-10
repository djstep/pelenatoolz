"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createContractAction,
  createLedgerTypeAction,
  quickCreateApprovalStatusAction,
  updateContractAction,
  type ContractsActionState,
} from "@/features/contracts/actions";
import { VAT_RATE_PRESETS, computeContractVat } from "@/features/contracts/lib/vat";
import {
  EntityPicker,
  type PickerOption,
} from "@/features/counterparties/components/entity-picker";
import {
  quickCreateCompanyAction,
  quickCreateCounterpartyAction,
} from "@/features/counterparties/actions";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useActionToast } from "@/shared/ui/toast";

const initial: ContractsActionState = {};

export type ContractFormDefaults = {
  id?: string;
  date?: string;
  number?: string;
  companyId?: string;
  counterpartyId?: string;
  ledgerTypeId?: string | null;
  amount?: number;
  vatEnabled?: boolean;
  vatRate?: number | null;
  vatAmount?: number | null;
  isPreliminary?: boolean;
  statusId?: string;
  tags?: string[];
  summary?: string | null;
  comment?: string | null;
  creditsName?: string | null;
};

function toDateInput(value?: string | Date | null) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function ContractFormModal({
  projectId,
  locale,
  open,
  onClose,
  companies,
  counterparties,
  ledgerTypes: initialLedgerTypes,
  statuses: initialStatuses,
  existingTags,
  defaults,
  defaultStatusId,
}: {
  projectId: string;
  locale: string;
  open: boolean;
  onClose: () => void;
  companies: PickerOption[];
  counterparties: PickerOption[];
  ledgerTypes: { id: string; name: string }[];
  statuses: { id: string; name: string; color: string }[];
  existingTags: string[];
  defaults?: ContractFormDefaults | null;
  defaultStatusId: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(defaults?.id);
  const bound = isEdit
    ? updateContractAction.bind(null, projectId, defaults!.id!)
    : createContractAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);

  const [companyId, setCompanyId] = useState(defaults?.companyId ?? "");
  const [counterpartyId, setCounterpartyId] = useState(
    defaults?.counterpartyId ?? "",
  );
  const [companyOptions, setCompanyOptions] = useState(companies);
  const [cpOptions, setCpOptions] = useState(counterparties);
  const [ledgerTypes, setLedgerTypes] = useState(initialLedgerTypes);
  const [statuses, setStatuses] = useState(initialStatuses);
  const [ledgerTypeId, setLedgerTypeId] = useState(
    defaults?.ledgerTypeId ?? "",
  );
  const [statusId, setStatusId] = useState(
    defaults?.statusId ?? defaultStatusId,
  );
  const [amount, setAmount] = useState(String(defaults?.amount ?? ""));
  const [vatEnabled, setVatEnabled] = useState(defaults?.vatEnabled ?? true);
  const [vatRate, setVatRate] = useState(
    String(defaults?.vatRate ?? 22),
  );
  const [vatManual, setVatManual] = useState(
    defaults?.vatAmount != null && defaults?.vatRate == null
      ? String(defaults.vatAmount)
      : "",
  );
  const [newLedger, setNewLedger] = useState("");
  const [newStatus, setNewStatus] = useState("");

  useEffect(() => {
    if (!open) return;
    setCompanyId(defaults?.companyId ?? "");
    setCounterpartyId(defaults?.counterpartyId ?? "");
    setLedgerTypeId(defaults?.ledgerTypeId ?? "");
    setStatusId(defaults?.statusId ?? defaultStatusId);
    setAmount(String(defaults?.amount ?? ""));
    setVatEnabled(defaults?.vatEnabled ?? true);
    setVatRate(String(defaults?.vatRate ?? 22));
    setVatManual("");
    setCompanyOptions(companies);
    setCpOptions(counterparties);
    setLedgerTypes(initialLedgerTypes);
    setStatuses(initialStatuses);
  }, [open, defaults, defaultStatusId, companies, counterparties, initialLedgerTypes, initialStatuses]);

  useEffect(() => {
    if (state.success && state.contractId && !isEdit) {
      onClose();
      router.push(
        `/${locale}/projects/${projectId}/counterparties/contracts/${state.contractId}`,
      );
    } else if (state.success && isEdit) {
      onClose();
    }
  }, [state.success, state.contractId, isEdit, onClose, router, locale, projectId]);

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
      title={isEdit ? "Редактирование договора" : "Новый договор"}
      wide
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="submit" form="contract-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
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
      <form id="contract-form" action={action} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="date">Дата *</Label>
            <Input
              id="date"
              name="date"
              type="date"
              required
              defaultValue={toDateInput(defaults?.date)}
            />
          </div>
          <div>
            <Label htmlFor="number">Номер *</Label>
            <Input
              id="number"
              name="number"
              required
              defaultValue={defaults?.number ?? ""}
            />
          </div>
        </div>

        <EntityPicker
          name="companyId"
          label="Компания *"
          options={companyOptions}
          value={companyId}
          onChange={setCompanyId}
          onQuickCreate={async (fd) => {
            const name = String(fd.get("name") ?? "");
            const r = await quickCreateCompanyAction(projectId, name);
            if ("id" in r) {
              setCompanyOptions((prev) =>
                prev.some((x) => x.id === r.id) ? prev : [...prev, r],
              );
              setCompanyId(r.id);
            }
            return r;
          }}
        />

        <EntityPicker
          name="counterpartyId"
          label="Контрагент *"
          options={cpOptions}
          value={counterpartyId}
          onChange={setCounterpartyId}
          onQuickCreate={async (fd) => {
            const name = String(fd.get("name") ?? "");
            const type = (String(fd.get("type") ?? "LEGAL_ENTITY") ||
              "LEGAL_ENTITY") as
              | "LEGAL_ENTITY"
              | "IP"
              | "INDIVIDUAL"
              | "SELF_EMPLOYED";
            const r = await quickCreateCounterpartyAction(projectId, name, type);
            if ("id" in r) {
              setCpOptions((prev) =>
                prev.some((x) => x.id === r.id) ? prev : [...prev, r],
              );
              setCounterpartyId(r.id);
            }
            return r;
          }}
          createFields={
            <div>
              <Label htmlFor="cp-type">Тип</Label>
              <Select id="cp-type" name="type" defaultValue="LEGAL_ENTITY">
                <option value="LEGAL_ENTITY">Юрлицо</option>
                <option value="IP">ИП</option>
                <option value="INDIVIDUAL">Физлицо</option>
                <option value="SELF_EMPLOYED">Самозанятый</option>
              </Select>
            </div>
          }
        />

        <div>
          <Label htmlFor="ledgerTypeId">Тип ведомости</Label>
          <div className="flex flex-wrap gap-2">
            <Select
              id="ledgerTypeId"
              name="ledgerTypeId"
              value={ledgerTypeId}
              onChange={(e) => setLedgerTypeId(e.target.value)}
            >
              <option value="">—</option>
              {ledgerTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Input
              placeholder="Свой тип…"
              value={newLedger}
              onChange={(e) => setNewLedger(e.target.value)}
              className="max-w-[10rem]"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const r = await createLedgerTypeAction(projectId, newLedger);
                if ("id" in r) {
                  setLedgerTypes((prev) => [...prev, r]);
                  setLedgerTypeId(r.id);
                  setNewLedger("");
                }
              }}
            >
              +
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="amount">Сумма (без НДС) *</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              min={0}
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="vatEnabled"
                checked={vatEnabled}
                onChange={(e) => setVatEnabled(e.target.checked)}
              />
              С НДС
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="isPreliminary"
                defaultChecked={defaults?.isPreliminary ?? false}
              />
              Предварительная сумма
            </label>
          </div>
        </div>

        {vatEnabled ? (
          <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-white/[0.02] p-3 sm:grid-cols-3">
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
                <option value="custom">Другая…</option>
              </Select>
              {vatRate === "custom" ? (
                <Input
                  className="mt-2"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  name="vatRate"
                  placeholder="%"
                  defaultValue={defaults?.vatRate ?? ""}
                />
              ) : null}
            </div>
            <div>
              <Label htmlFor="vatAmountManual">НДС вручную</Label>
              <Input
                id="vatAmountManual"
                name="vatAmountManual"
                type="number"
                min={0}
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
        ) : (
          <input type="hidden" name="vatRate" value="" />
        )}

        <div>
          <Label htmlFor="statusId">Статус</Label>
          <div className="flex flex-wrap gap-2">
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
            <Input
              placeholder="Свой статус…"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              className="max-w-[10rem]"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const r = await quickCreateApprovalStatusAction(
                  projectId,
                  newStatus,
                );
                if ("id" in r) {
                  setStatuses((prev) => [...prev, r]);
                  setStatusId(r.id);
                  setNewStatus("");
                }
              }}
            >
              +
            </Button>
          </div>
        </div>

        <div>
          <Label htmlFor="tags">Теги</Label>
          <Input
            id="tags"
            name="tags"
            list="contract-tags-list"
            defaultValue={(defaults?.tags ?? []).join(", ")}
            placeholder="через запятую"
          />
          <datalist id="contract-tags-list">
            {existingTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div>
          <Label htmlFor="summary">Краткое содержание</Label>
          <textarea
            id="summary"
            name="summary"
            rows={2}
            className="glass-input w-full rounded-xl px-3 py-2 text-sm"
            defaultValue={defaults?.summary ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="comment">Примечание</Label>
          <textarea
            id="comment"
            name="comment"
            rows={2}
            className="glass-input w-full rounded-xl px-3 py-2 text-sm"
            defaultValue={defaults?.comment ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="creditsName">Название для титров</Label>
          <Input
            id="creditsName"
            name="creditsName"
            defaultValue={defaults?.creditsName ?? ""}
          />
        </div>
      </form>
    </Modal>
  );
}
