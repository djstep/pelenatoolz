"use client";

import type { CounterpartyType } from "@prisma/client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COUNTERPARTY_TYPES, counterpartyTypeLabels } from "@/features/counterparties/labels";
import {
  createExpenseTypeAction,
  createPaymentFormAction,
  renameExpenseTypeAction,
  saveBudgetPercentsAction,
  saveCounterpartyPaymentFormsAction,
  setExpenseTypeArchivedAction,
  setPaymentFormArchivedAction,
  updatePaymentFormAction,
  type DictionaryActionState,
} from "@/features/finance/actions-budget-dictionaries";
import { formatPercent } from "@/features/finance/lib/percent";
import type {
  BudgetPercents,
  ExpenseTypeRow,
  PaymentFormRow,
} from "@/features/finance/queries-budget-dictionaries";
import { Button } from "@/shared/ui/button";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { useSafeActionState } from "@/shared/ui/forms/use-safe-action-state";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { toast, useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";

const initial: DictionaryActionState = {};

const sectionClass =
  "overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-solid)]";

function SectionHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="border-b border-[var(--border)] px-4 py-3">
      <h3 className="font-display text-base font-bold">{title}</h3>
      <p className="mt-1 text-sm text-[var(--muted-fg)]">{hint}</p>
    </div>
  );
}

/** Вызов действия из кнопки: ошибка — уведомлением, успех — обновить страницу. */
function useRowAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  function run(call: () => Promise<DictionaryActionState>) {
    setBusy(true);
    startTransition(async () => {
      try {
        const result = await call();
        if (result.error) toast.error(result.error);
        else router.refresh();
      } finally {
        setBusy(false);
      }
    });
  }
  return { busy, run };
}

function percentInputValue(value: number | null) {
  return value == null ? "" : String(value);
}

// ---------------------------------------------------------------------------
// Резерв и агентские
// ---------------------------------------------------------------------------

function BudgetPercentsSection({
  projectId,
  percents,
  canEdit,
}: {
  projectId: string;
  percents: BudgetPercents;
  canEdit: boolean;
}) {
  const [state, action, pending] = useSafeActionState(
    saveBudgetPercentsAction.bind(null, projectId),
    initial,
  );
  useActionToast(state);

  return (
    <section className={sectionClass}>
      <SectionHead
        title="Резерв и агентские"
        hint="Только в сводной смете продюсера: процент от суммы смет цехов с налогом. Действуют всегда, смена процента записывается в журнал."
      />
      <form
        onSubmit={submitKeepingFields(action)}
        className="flex flex-wrap items-end gap-3 px-4 py-3"
      >
        <div className="w-36">
          <Label htmlFor="reservePercent">Резерв, %</Label>
          <Input
            id="reservePercent"
            name="reservePercent"
            inputMode="decimal"
            required
            defaultValue={String(percents.reservePercent)}
            disabled={!canEdit || pending}
            className="text-right tabular-nums"
          />
        </div>
        <div className="w-36">
          <Label htmlFor="agencyPercent">Агентские, %</Label>
          <Input
            id="agencyPercent"
            name="agencyPercent"
            inputMode="decimal"
            required
            defaultValue={String(percents.agencyPercent)}
            disabled={!canEdit || pending}
            className="text-right tabular-nums"
          />
        </div>
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
        ) : null}
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Типы расходов
// ---------------------------------------------------------------------------

function AddExpenseTypeForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useSafeActionState(
    createExpenseTypeAction.bind(null, projectId),
    initial,
  );
  useActionToast(state);
  const [name, setName] = useState("");
  useActionSuccess(state, () => setName(""));
  return (
    <form
      onSubmit={submitKeepingFields(action)}
      className="flex flex-wrap items-end gap-2 border-b border-[var(--border)] px-4 py-3"
    >
      <div className="min-w-[14rem] flex-1">
        <Label htmlFor="expense-type-name">Новый тип расхода</Label>
        <Input
          id="expense-type-name"
          name="name"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "…" : "Добавить"}
      </Button>
    </form>
  );
}

function RenameExpenseTypeModal({
  projectId,
  row,
  onClose,
}: {
  projectId: string;
  row: ExpenseTypeRow;
  onClose: () => void;
}) {
  const [state, action, pending] = useSafeActionState(
    renameExpenseTypeAction.bind(null, projectId, row.id),
    initial,
  );
  useActionToast(state);
  useActionSuccess(state, onClose);
  return (
    <Modal
      guardUnsaved
      open
      onClose={onClose}
      title="Тип расхода"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="submit" form="expense-type-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" data-modal-cancel onClick={onClose}>
            Отмена
          </Button>
          {state.error ? <span className="w-full text-sm text-[var(--danger)]">{state.error}</span> : null}
        </div>
      }
    >
      <form id="expense-type-form" onSubmit={submitKeepingFields(action)}>
        <Label htmlFor="expense-type-rename">Название</Label>
        <Input id="expense-type-rename" name="name" required maxLength={80} defaultValue={row.name} />
      </form>
    </Modal>
  );
}

function ExpenseTypesSection({
  projectId,
  types,
  canEdit,
}: {
  projectId: string;
  types: ExpenseTypeRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState<ExpenseTypeRow | null>(null);
  const { busy, run } = useRowAction();

  return (
    <section className={sectionClass}>
      <SectionHead
        title="Типы расходов"
        hint="Тип строки сметы: для отчётов «сколько на технику, на людей». Налог от типа не зависит."
      />
      {canEdit ? <AddExpenseTypeForm projectId={projectId} /> : null}
      <ul className="divide-y divide-[var(--border)]/60" aria-label="Типы расходов">
        {types.map((row) => (
          <li
            key={row.id}
            className={`flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm ${row.archived ? "text-[var(--muted-fg)]" : ""}`}
            data-expense-type={row.name}
          >
            <span className="min-w-0 flex-1">
              <span className={row.archived ? "" : "font-medium"}>{row.name}</span>
              {row.archived ? <span className="ml-2 text-xs">в архиве</span> : null}
            </span>
            {canEdit ? (
              <span className="flex flex-wrap gap-1">
                {!row.archived ? (
                  <Button type="button" variant="secondary" onClick={() => setRenaming(row)}>
                    Переименовать
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => run(() => setExpenseTypeArchivedAction(projectId, row.id, !row.archived))}
                >
                  {row.archived ? "Вернуть" : "В архив"}
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {renaming ? (
        <RenameExpenseTypeModal
          key={renaming.id}
          projectId={projectId}
          row={renaming}
          onClose={() => {
            setRenaming(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Формы оплаты
// ---------------------------------------------------------------------------

function PaymentFormModal({
  projectId,
  row,
  onClose,
}: {
  projectId: string;
  row: PaymentFormRow | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useSafeActionState(
    row
      ? updatePaymentFormAction.bind(null, projectId, row.id)
      : createPaymentFormAction.bind(null, projectId),
    initial,
  );
  useActionToast(state);
  useActionSuccess(state, onClose);
  return (
    <Modal
      guardUnsaved
      open
      onClose={onClose}
      title={row ? "Форма оплаты" : "Новая форма оплаты"}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="submit" form="payment-form-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" data-modal-cancel onClick={onClose}>
            Отмена
          </Button>
          {state.error ? <span className="w-full text-sm text-[var(--danger)]">{state.error}</span> : null}
        </div>
      }
    >
      <form id="payment-form-form" onSubmit={submitKeepingFields(action)} className="space-y-4">
        <div>
          <Label htmlFor="payment-form-name">Название</Label>
          <Input id="payment-form-name" name="name" required maxLength={80} defaultValue={row?.name ?? ""} />
        </div>
        <div className="w-44">
          <Label htmlFor="payment-form-percent">Налог по умолчанию, %</Label>
          <Input
            id="payment-form-percent"
            name="defaultTaxPercent"
            inputMode="decimal"
            placeholder="пусто"
            defaultValue={percentInputValue(row?.defaultTaxPercent ?? null)}
            className="text-right tabular-nums"
          />
        </div>
        <p className="text-xs text-[var(--muted-fg)]">
          Налог на доход исполнителя, начисляется сверху суммы. Пусто — процента по умолчанию нет,
          налог вводится руками.
        </p>
      </form>
    </Modal>
  );
}

function PaymentFormsSection({
  projectId,
  forms,
  canEdit,
}: {
  projectId: string;
  forms: PaymentFormRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PaymentFormRow | "new" | null>(null);
  const { busy, run } = useRowAction();

  return (
    <section className={sectionClass}>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h3 className="font-display text-base font-bold">Формы оплаты</h3>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Налог строки сметы берётся из её формы оплаты; в строке процент можно поменять.
          </p>
        </div>
        {canEdit ? (
          <Button type="button" onClick={() => setEditing("new")}>
            Добавить форму
          </Button>
        ) : null}
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-xs font-semibold text-[var(--muted-fg)]">
            <th className="px-4 py-2">Форма оплаты</th>
            <th className="px-4 py-2 text-right">Налог по умолчанию</th>
            {canEdit ? <th className="px-4 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {forms.map((row) => (
            <tr
              key={row.id}
              className={`border-b border-[var(--border)]/60 last:border-0 ${row.archived ? "text-[var(--muted-fg)]" : ""}`}
              data-payment-form={row.name}
            >
              <td className="px-4 py-2.5">
                <span className={row.archived ? "" : "font-medium"}>{row.name}</span>
                {row.archived ? <span className="ml-2 text-xs">в архиве</span> : null}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{formatPercent(row.defaultTaxPercent)}</td>
              {canEdit ? (
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <span className="inline-flex gap-1">
                    {!row.archived ? (
                      <Button type="button" variant="secondary" onClick={() => setEditing(row)}>
                        Изменить
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => run(() => setPaymentFormArchivedAction(projectId, row.id, !row.archived))}
                    >
                      {row.archived ? "Вернуть" : "В архив"}
                    </Button>
                  </span>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {editing ? (
        <PaymentFormModal
          key={editing === "new" ? "new" : editing.id}
          projectId={projectId}
          row={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Тип контрагента → форма оплаты
// ---------------------------------------------------------------------------

function CounterpartyMappingSection({
  projectId,
  forms,
  mapping,
  canEdit,
}: {
  projectId: string;
  forms: PaymentFormRow[];
  mapping: Partial<Record<CounterpartyType, string>>;
  canEdit: boolean;
}) {
  const [state, action, pending] = useSafeActionState(
    saveCounterpartyPaymentFormsAction.bind(null, projectId),
    initial,
  );
  useActionToast(state);
  const active = forms.filter((f) => !f.archived);

  return (
    <section className={sectionClass}>
      <SectionHead
        title="Налог в договоре и акте"
        hint="Тип контрагента → форма оплаты. В новом договоре и акте налог по умолчанию — процент этой формы; не сопоставлено — пусто."
      />
      <form onSubmit={submitKeepingFields(action)} className="space-y-3 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {COUNTERPARTY_TYPES.map((type) => (
            <div key={type}>
              <Label htmlFor={`map-${type}`}>{counterpartyTypeLabels[type]}</Label>
              <Select
                id={`map-${type}`}
                name={`map-${type}`}
                defaultValue={mapping[type] ?? ""}
                disabled={!canEdit || pending}
              >
                <option value="">— не сопоставлено</option>
                {active.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.defaultTaxPercent == null ? f.name : `${f.name} · ${formatPercent(f.defaultTaxPercent)}`}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
        {canEdit ? (
          <Button type="submit" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
        ) : null}
      </form>
    </section>
  );
}

/** Справочники сметы в «Финансы → Настройки». Без права правки — только просмотр. */
export function BudgetDictionariesWorkspace({
  projectId,
  percents,
  expenseTypes,
  paymentForms,
  mapping,
  canEdit,
}: {
  projectId: string;
  percents: BudgetPercents;
  expenseTypes: ExpenseTypeRow[];
  paymentForms: PaymentFormRow[];
  mapping: Partial<Record<CounterpartyType, string>>;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-6">
      <BudgetPercentsSection projectId={projectId} percents={percents} canEdit={canEdit} />
      <PaymentFormsSection projectId={projectId} forms={paymentForms} canEdit={canEdit} />
      <CounterpartyMappingSection
        projectId={projectId}
        forms={paymentForms}
        mapping={mapping}
        canEdit={canEdit}
      />
      <ExpenseTypesSection projectId={projectId} types={expenseTypes} canEdit={canEdit} />
    </div>
  );
}
