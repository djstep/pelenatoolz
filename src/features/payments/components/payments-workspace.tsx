"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import {
  createCashPaymentAction,
  deleteCashPaymentAction,
  setCashPaymentLockedAction,
  updateCashPaymentAction,
  type PaymentActionState,
} from "@/features/payments/actions";
import { computeTaxAmounts, roundMoney } from "@/features/payments/lib/calc";
import type { CashPaymentListRow } from "@/features/payments/queries";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useActionToast, useToast } from "@/shared/ui/toast";

const initial: PaymentActionState = {};

type Opt = { id: string; name: string };
type LineOpt = { id: string; title: string };

type BreakdownRow = {
  key: string;
  budgetLineId: string;
  amount: number;
  comment: string;
};

function money(n: number, currency: string) {
  return `${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function toDateInput(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toISOString().slice(0, 10);
}

function newKey() {
  return `b-${Math.random().toString(36).slice(2, 9)}`;
}

function PaymentFormFields({
  payment,
  counterparties,
  companies,
  lines,
}: {
  payment?: CashPaymentListRow;
  counterparties: Opt[];
  companies: Opt[];
  lines: LineOpt[];
}) {
  const [amount, setAmount] = useState(payment ? Number(payment.amount) : 0);
  const [taxPercent, setTaxPercent] = useState(
    payment?.taxPercent != null ? Number(payment.taxPercent) : "",
  );
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>(() =>
    payment?.breakdown?.length
      ? payment.breakdown.map((b) => ({
          key: newKey(),
          budgetLineId: b.budgetLineId,
          amount: Number(b.amount),
          comment: b.comment ?? "",
        }))
      : [
          {
            key: newKey(),
            budgetLineId: lines[0]?.id ?? "",
            amount: payment ? Number(payment.amount) : 0,
            comment: "",
          },
        ],
  );
  const [isLocked, setIsLocked] = useState(payment?.isLocked ?? false);

  const taxNum = taxPercent === "" ? null : Number(taxPercent);
  const tax = computeTaxAmounts(amount, taxNum);
  const breakdownSum = roundMoney(
    breakdown.reduce((s, r) => s + (Number(r.amount) || 0), 0),
  );
  const breakdownOk = Math.abs(breakdownSum - roundMoney(amount)) <= 0.01;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h4 className="text-sm font-semibold">Основная информация</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="counterpartyId">Контрагент (получатель) *</Label>
            <Select
              id="counterpartyId"
              name="counterpartyId"
              required
              defaultValue={payment?.counterpartyId ?? ""}
            >
              <option value="">— выберите —</option>
              {counterparties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="companyId">Компания (источник) *</Label>
            <Select
              id="companyId"
              name="companyId"
              required
              defaultValue={payment?.companyId ?? ""}
            >
              <option value="">— выберите —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="amount">Сумма *</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              min={0.01}
              step="0.01"
              required
              value={amount}
              onChange={(e) => {
                const next = Number(e.target.value);
                setAmount(next);
                setBreakdown((rows) =>
                  rows.length === 1
                    ? [{ ...rows[0]!, amount: next }]
                    : rows,
                );
              }}
            />
          </div>
          <div>
            <Label htmlFor="date">Дата *</Label>
            <Input
              id="date"
              name="date"
              type="date"
              required
              defaultValue={
                payment
                  ? toDateInput(payment.date)
                  : new Date().toISOString().slice(0, 10)
              }
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="comment">Примечание</Label>
            <Input
              id="comment"
              name="comment"
              defaultValue={payment?.comment ?? ""}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 border-t border-[var(--border)] pt-4">
        <h4 className="text-sm font-semibold">Налог</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="taxPercent">Ставка %</Label>
            <Input
              id="taxPercent"
              name="taxPercent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
            />
          </div>
          <div>
            <Label>Сумма налога</Label>
            <div className="glass-input flex h-10 items-center rounded-xl px-3 text-sm">
              {(tax.taxAmount ?? 0).toLocaleString("ru-RU")}
            </div>
          </div>
          <div>
            <Label>Итого с налогом</Label>
            <div className="glass-input flex h-10 items-center rounded-xl px-3 text-sm font-medium">
              {tax.amountWithTax.toLocaleString("ru-RU")}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3 border-t border-[var(--border)] pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Управленческий учёт</h4>
          <p
            className={`text-xs ${
              breakdownOk ? "text-[var(--muted-fg)]" : "text-[var(--danger)]"
            }`}
          >
            Разбивка: {breakdownSum.toLocaleString("ru-RU")} /{" "}
            {roundMoney(amount).toLocaleString("ru-RU")}
          </p>
        </div>
        <p className="text-xs text-[var(--muted-fg)]">
          Один платёж может закрывать несколько статей сметы.
        </p>
        <div className="space-y-2">
          {breakdown.map((row, index) => (
            <div
              key={row.key}
              className="grid gap-2 rounded-xl border border-[var(--border)] p-3 sm:grid-cols-[1fr_7rem_1fr_auto]"
            >
              <Select
                value={row.budgetLineId}
                onChange={(e) => {
                  const budgetLineId = e.target.value;
                  setBreakdown((prev) => {
                    const next = [...prev];
                    next[index] = { ...next[index]!, budgetLineId };
                    return next;
                  });
                }}
              >
                <option value="">Статья…</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min={0.01}
                step="0.01"
                value={row.amount}
                onChange={(e) => {
                  const a = Number(e.target.value);
                  setBreakdown((prev) => {
                    const next = [...prev];
                    next[index] = { ...next[index]!, amount: a };
                    return next;
                  });
                }}
              />
              <Input
                placeholder="Комментарий"
                value={row.comment}
                onChange={(e) => {
                  const comment = e.target.value;
                  setBreakdown((prev) => {
                    const next = [...prev];
                    next[index] = { ...next[index]!, comment };
                    return next;
                  });
                }}
              />
              <Button
                type="button"
                variant="danger"
                disabled={breakdown.length <= 1}
                onClick={() =>
                  setBreakdown((prev) => prev.filter((_, i) => i !== index))
                }
              >
                ×
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setBreakdown((prev) => [
              ...prev,
              {
                key: newKey(),
                budgetLineId: lines[0]?.id ?? "",
                amount: 0,
                comment: "",
              },
            ])
          }
        >
          + Статья в разбивке
        </Button>
        <input
          type="hidden"
          name="breakdownJson"
          value={JSON.stringify(
            breakdown.map(({ budgetLineId, amount: a, comment }) => ({
              budgetLineId,
              amount: a,
              comment: comment || null,
            })),
          )}
        />
      </section>

      <section className="border-t border-[var(--border)] pt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isLocked"
            value="true"
            checked={isLocked}
            onChange={(e) => setIsLocked(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Зафиксировать платёж
        </label>
        <p className="mt-1 text-xs text-[var(--muted-fg)]">
          Зафиксированный платёж нельзя редактировать, пока фиксацию не снимут
          по праву в матрице ролей.
        </p>
      </section>
    </div>
  );
}

function PaymentModal({
  projectId,
  payment,
  counterparties,
  companies,
  lines,
  open,
  onClose,
}: {
  projectId: string;
  payment?: CashPaymentListRow;
  counterparties: Opt[];
  companies: Opt[];
  lines: LineOpt[];
  open: boolean;
  onClose: () => void;
}) {
  const bound = payment
    ? updateCashPaymentAction.bind(null, projectId, payment.id)
    : createCashPaymentAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={payment ? "Редактирование платежа" : "Новый платёж"}
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="cash-payment-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="cash-payment-form" action={action} key={payment?.id ?? "new"}>
        <PaymentFormFields
          payment={payment}
          counterparties={counterparties}
          companies={companies}
          lines={lines}
        />
      </form>
    </Modal>
  );
}

export function PaymentsWorkspace({
  projectId,
  locale,
  currency,
  payments,
  lines,
  counterparties,
  companies,
  filters,
  totals,
  canWrite,
  canUnlock,
}: {
  projectId: string;
  locale: string;
  currency: string;
  payments: CashPaymentListRow[];
  lines: LineOpt[];
  counterparties: Opt[];
  companies: Opt[];
  filters: {
    q: string;
    dateFrom: string;
    dateTo: string;
    budgetLineId: string;
    counterpartyId: string;
    companyId: string;
    locked: string;
  };
  totals: { count: number; amount: number; withTax: number };
  canWrite: boolean;
  canUnlock: boolean;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CashPaymentListRow | null>(null);

  const lineTitle = useMemo(
    () => new Map(lines.map((l) => [l.id, l.title])),
    [lines],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            Платежей
          </div>
          <div className="mt-1 text-xl font-semibold">{totals.count}</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            Сумма
          </div>
          <div className="mt-1 text-xl font-semibold">
            {money(totals.amount, currency)}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            С налогом
          </div>
          <div className="mt-1 text-xl font-semibold">
            {money(totals.withTax, currency)}
          </div>
        </div>
      </div>

      <form
        method="get"
        className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="sm:col-span-2 lg:col-span-3">
          <Label htmlFor="q">Поиск</Label>
          <Input
            id="q"
            name="q"
            defaultValue={filters.q}
            placeholder="Контрагент, компания, статья, примечание…"
          />
        </div>
        <div>
          <Label htmlFor="dateFrom">Дата с</Label>
          <Input
            id="dateFrom"
            name="dateFrom"
            type="date"
            defaultValue={filters.dateFrom}
          />
        </div>
        <div>
          <Label htmlFor="dateTo">Дата по</Label>
          <Input
            id="dateTo"
            name="dateTo"
            type="date"
            defaultValue={filters.dateTo}
          />
        </div>
        <div>
          <Label htmlFor="budgetLineId">Статья</Label>
          <Select
            id="budgetLineId"
            name="budgetLineId"
            defaultValue={filters.budgetLineId}
          >
            <option value="">Все</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="counterpartyId">Контрагент</Label>
          <Select
            id="counterpartyId"
            name="counterpartyId"
            defaultValue={filters.counterpartyId}
          >
            <option value="">Все</option>
            {counterparties.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="companyId">Компания</Label>
          <Select
            id="companyId"
            name="companyId"
            defaultValue={filters.companyId}
          >
            <option value="">Все</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="locked">Фиксация</Label>
          <Select id="locked" name="locked" defaultValue={filters.locked}>
            <option value="">Все</option>
            <option value="yes">Зафиксированные</option>
            <option value="no">Не зафиксированные</option>
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit">Применить</Button>
        </div>
      </form>

      {canWrite ? (
        <Button type="button" onClick={() => setCreating(true)}>
          + Платёж
        </Button>
      ) : null}

      {payments.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Платежей пока нет. Это кассовое движение денег — отдельно от
          начислений.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Контрагент</th>
                <th className="px-4 py-3">Компания</th>
                <th className="px-4 py-3">Статьи</th>
                <th className="px-4 py-3">Сумма</th>
                <th className="px-4 py-3">С налогом</th>
                <th className="px-4 py-3">Статус</th>
                {canWrite || canUnlock ? <th className="px-4 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-[var(--border)]/60">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link
                      href={`/${locale}/projects/${projectId}/payments/${p.id}`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      {formatDateShort(p.date)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/${locale}/projects/${projectId}/payments/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.counterparty.name}
                    </Link>
                    {p.comment ? (
                      <div className="text-xs text-[var(--muted-fg)]">
                        {p.comment}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{p.company.name}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted-fg)]">
                    {p.breakdown
                      .map(
                        (b) =>
                          `${b.budgetLine?.title ?? lineTitle.get(b.budgetLineId) ?? "—"}: ${Number(b.amount).toLocaleString("ru-RU")}`,
                      )
                      .join(" · ")}
                  </td>
                  <td className="px-4 py-3">
                    {money(Number(p.amount), currency)}
                  </td>
                  <td className="px-4 py-3">
                    {money(Number(p.amountWithTax), currency)}
                  </td>
                  <td className="px-4 py-3">
                    {p.isLocked ? (
                      <span className="text-amber-300/90">зафиксирован</span>
                    ) : (
                      <span className="text-[var(--muted-fg)]">открыт</span>
                    )}
                  </td>
                  {canWrite || canUnlock ? (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        {canWrite && !p.isLocked ? (
                          <>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={pending}
                              onClick={() => setEditing(p)}
                            >
                              Изменить
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={pending}
                              onClick={() => {
                                start(async () => {
                                  const res = await setCashPaymentLockedAction(
                                    projectId,
                                    p.id,
                                    true,
                                  );
                                  if (res.error) toast.error(res.error);
                                  else toast.success(res.success ?? "Ок");
                                });
                              }}
                            >
                              Зафиксировать
                            </Button>
                            <form
                              action={async () => {
                                try {
                                  await deleteCashPaymentAction(
                                    projectId,
                                    p.id,
                                  );
                                } catch {
                                  toast.error("Не удалось удалить");
                                }
                              }}
                            >
                              <Button type="submit" variant="danger">
                                ×
                              </Button>
                            </form>
                          </>
                        ) : null}
                        {p.isLocked && canUnlock ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={pending}
                            onClick={() => {
                              start(async () => {
                                const res = await setCashPaymentLockedAction(
                                  projectId,
                                  p.id,
                                  false,
                                );
                                if (res.error) toast.error(res.error);
                                else toast.success(res.success ?? "Ок");
                              });
                            }}
                          >
                            Снять фиксацию
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PaymentModal
        projectId={projectId}
        counterparties={counterparties}
        companies={companies}
        lines={lines}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <PaymentModal
        projectId={projectId}
        payment={editing ?? undefined}
        counterparties={counterparties}
        companies={companies}
        lines={lines}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
