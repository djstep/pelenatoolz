"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  createCompanyAction,
  createCounterpartyAction,
  deleteCompanyAction,
  deleteCounterpartyAction,
  updateCompanyAction,
  updateCounterpartyAction,
  type CounterpartiesActionState,
} from "@/features/counterparties/actions";
import {
  COUNTERPARTY_TYPES,
  counterpartyTypeLabels,
} from "@/features/counterparties/labels";
import type {
  CompanyListItem,
  CounterpartyListItem,
} from "@/features/counterparties/queries";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useActionToast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/cn";

const initial: CounterpartiesActionState = {};

type Tab = "companies" | "counterparties";

function CompanyFormFields({ company }: { company?: CompanyListItem }) {
  return (
    <div className="grid gap-3">
      <div>
        <Label htmlFor="name">Название *</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={company?.name}
          placeholder="ООО «Кинопродакшн»"
        />
      </div>
      <div>
        <Label htmlFor="inn">ИНН</Label>
        <Input id="inn" name="inn" defaultValue={company?.inn ?? ""} />
      </div>
      <div>
        <Label htmlFor="requisites">Реквизиты</Label>
        <textarea
          id="requisites"
          name="requisites"
          rows={4}
          defaultValue={company?.requisites ?? ""}
          className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          placeholder="Р/с, банк, БИК…"
        />
      </div>
      <div>
        <Label htmlFor="notes">Заметки</Label>
        <Input id="notes" name="notes" defaultValue={company?.notes ?? ""} />
      </div>
    </div>
  );
}

function CounterpartyFormFields({
  counterparty,
}: {
  counterparty?: CounterpartyListItem;
}) {
  return (
    <div className="grid gap-3">
      <div>
        <Label htmlFor="name">Название *</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={counterparty?.name}
          placeholder="ИП Иванов / Студия…"
        />
      </div>
      <div>
        <Label htmlFor="type">Тип *</Label>
        <Select
          id="type"
          name="type"
          defaultValue={counterparty?.type ?? "LEGAL_ENTITY"}
        >
          {COUNTERPARTY_TYPES.map((t) => (
            <option key={t} value={t}>
              {counterpartyTypeLabels[t]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="inn">ИНН</Label>
        <Input id="inn" name="inn" defaultValue={counterparty?.inn ?? ""} />
      </div>
      <div>
        <Label htmlFor="contacts">Контакты</Label>
        <textarea
          id="contacts"
          name="contacts"
          rows={3}
          defaultValue={counterparty?.contacts ?? ""}
          className="glass-input w-full rounded-xl px-3 py-2 text-sm"
          placeholder="Телефон, email, контактное лицо…"
        />
      </div>
      <div>
        <Label htmlFor="notes">Заметки</Label>
        <Input
          id="notes"
          name="notes"
          defaultValue={counterparty?.notes ?? ""}
        />
      </div>
    </div>
  );
}

function CompanyModal({
  projectId,
  company,
  open,
  onClose,
}: {
  projectId: string;
  company?: CompanyListItem;
  open: boolean;
  onClose: () => void;
}) {
  const bound = company
    ? updateCompanyAction.bind(null, projectId, company.id)
    : createCompanyAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={company ? "Редактирование компании" : "Новая компания"}
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="company-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="company-form" action={action} key={company?.id ?? "new"}>
        <CompanyFormFields company={company} />
      </form>
    </Modal>
  );
}

function CounterpartyModal({
  projectId,
  counterparty,
  open,
  onClose,
}: {
  projectId: string;
  counterparty?: CounterpartyListItem;
  open: boolean;
  onClose: () => void;
}) {
  const bound = counterparty
    ? updateCounterpartyAction.bind(null, projectId, counterparty.id)
    : createCounterpartyAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={counterparty ? "Редактирование контрагента" : "Новый контрагент"}
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="counterparty-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form
        id="counterparty-form"
        action={action}
        key={counterparty?.id ?? "new"}
      >
        <CounterpartyFormFields counterparty={counterparty} />
      </form>
    </Modal>
  );
}

export function CounterpartiesWorkspace({
  projectId,
  companies,
  counterparties,
  canWrite,
}: {
  projectId: string;
  companies: CompanyListItem[];
  counterparties: CounterpartyListItem[];
  canWrite: boolean;
}) {
  const [tab, setTab] = useState<Tab>("counterparties");
  const [search, setSearch] = useState("");
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [editingCompany, setEditingCompany] = useState<CompanyListItem | null>(
    null,
  );
  const [creatingCp, setCreatingCp] = useState(false);
  const [editingCp, setEditingCp] = useState<CounterpartyListItem | null>(null);

  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      [c.name, c.inn, c.requisites, c.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [companies, search]);

  const filteredCounterparties = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return counterparties;
    return counterparties.filter((c) =>
      [c.name, counterpartyTypeLabels[c.type], c.inn, c.contacts, c.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [counterparties, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-[var(--border)] p-0.5">
          {(
            [
              ["counterparties", "Контрагенты"],
              ["companies", "Наши компании"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={cn(
                "rounded-md px-3 py-1.5 text-xs",
                tab === id
                  ? "bg-white/10 text-white"
                  : "text-[var(--muted-fg)] hover:text-white",
              )}
              onClick={() => setTab(id)}
            >
              {label}
              <span className="ml-1 opacity-60">
                (
                {id === "companies" ? companies.length : counterparties.length}
                )
              </span>
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск…"
          className="max-w-xs"
        />
        {canWrite ? (
          <Button
            type="button"
            onClick={() =>
              tab === "companies" ? setCreatingCompany(true) : setCreatingCp(true)
            }
          >
            {tab === "companies" ? "+ Компания" : "+ Контрагент"}
          </Button>
        ) : null}
      </div>

      {tab === "companies" ? (
        filteredCompanies.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">
            Компаний пока нет. Добавьте юрлица, с которых идут платежи.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                  <th className="px-4 py-3">Название</th>
                  <th className="px-4 py-3">ИНН</th>
                  <th className="px-4 py-3">Реквизиты</th>
                  <th className="px-4 py-3">Операций</th>
                  {canWrite ? <th className="px-4 py-3" /> : null}
                </tr>
              </thead>
              <tbody>
                {filteredCompanies.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border)]/60">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-[var(--muted-fg)]">
                      {c.inn || "—"}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-[var(--muted-fg)]">
                      {c.requisites || "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-fg)]">
                      {c.usageCount}
                    </td>
                    {canWrite ? (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex gap-1">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setEditingCompany(c)}
                          >
                            Изменить
                          </Button>
                          <form
                            action={async () => {
                              await deleteCompanyAction(projectId, c.id);
                            }}
                          >
                            <Button type="submit" variant="danger">
                              ×
                            </Button>
                          </form>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : filteredCounterparties.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Контрагентов пока нет. Добавьте получателей платежей.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-4 py-3">Название</th>
                <th className="px-4 py-3">Тип</th>
                <th className="px-4 py-3">Контакты</th>
                <th className="px-4 py-3">Операций</th>
                {canWrite ? <th className="px-4 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {filteredCounterparties.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)]/60">
                  <td className="px-4 py-3 font-medium">
                    {c.name}
                    {c.inn ? (
                      <div className="text-xs text-[var(--muted-fg)]">
                        ИНН {c.inn}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-fg)]">
                    {counterpartyTypeLabels[c.type]}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-[var(--muted-fg)]">
                    {c.contacts || "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-fg)]">
                    {c.usageCount}
                  </td>
                  {canWrite ? (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setEditingCp(c)}
                        >
                          Изменить
                        </Button>
                        <form
                          action={async () => {
                            await deleteCounterpartyAction(projectId, c.id);
                          }}
                        >
                          <Button type="submit" variant="danger">
                            ×
                          </Button>
                        </form>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CompanyModal
        projectId={projectId}
        open={creatingCompany}
        onClose={() => setCreatingCompany(false)}
      />
      <CompanyModal
        projectId={projectId}
        company={editingCompany ?? undefined}
        open={editingCompany != null}
        onClose={() => setEditingCompany(null)}
      />
      <CounterpartyModal
        projectId={projectId}
        open={creatingCp}
        onClose={() => setCreatingCp(false)}
      />
      <CounterpartyModal
        projectId={projectId}
        counterparty={editingCp ?? undefined}
        open={editingCp != null}
        onClose={() => setEditingCp(null)}
      />
    </div>
  );
}
