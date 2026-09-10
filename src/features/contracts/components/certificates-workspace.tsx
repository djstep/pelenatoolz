"use client";

import { useMemo, useState } from "react";
import {
  CertificateFormModal,
  type CertificateFormDefaults,
} from "@/features/contracts/components/certificate-form-modal";
import { exportCertificatesXls } from "@/features/contracts/lib/export-certificates-xls";
import { CERTIFICATE_COLUMNS } from "@/features/contracts/lib/table-columns";
import type { CertificateListItem } from "@/features/contracts/queries";
import { useTableLayout } from "@/shared/hooks/use-table-layout";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";

type StatusOpt = { id: string; name: string; color: string };
type EntityOpt = { id: string; name: string };
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

function money(n: number | string | { toString(): string } | null | undefined) {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : Number(n.toString());
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2 });
}

function cellValue(row: CertificateListItem, colId: string): string {
  switch (colId) {
    case "date":
      return formatDateShort(row.date);
    case "number":
      return row.number;
    case "counterparty":
      return row.counterparty.name;
    case "company":
      return row.company.name;
    case "contract":
      return row.contract?.number ?? "—";
    case "payment":
      return row.payment
        ? `${formatDateShort(row.payment.date)} · ${money(row.payment.amountWithTax)}`
        : "—";
    case "amount":
      return money(row.amount);
    case "amountWithVat":
      return money(row.amountWithVat);
    case "status":
      return row.status.name;
    case "summary":
      return row.summary ?? "—";
    case "files":
      return String(row.files.length);
    default:
      return "";
  }
}

export function CertificatesWorkspace({
  projectId,
  certificates,
  companies,
  counterparties,
  contracts,
  payments,
  statuses,
  defaultStatusId,
  canWrite,
  initialCounterpartyId,
  initialContractId,
  initialPaymentId,
  initialCompanyId,
  hideCreate = false,
}: {
  projectId: string;
  certificates: CertificateListItem[];
  companies: EntityOpt[];
  counterparties: EntityOpt[];
  contracts: ContractOpt[];
  payments: PaymentOpt[];
  statuses: StatusOpt[];
  defaultStatusId: string;
  canWrite: boolean;
  initialCounterpartyId?: string;
  initialContractId?: string;
  initialPaymentId?: string;
  initialCompanyId?: string;
  hideCreate?: boolean;
}) {
  const {
    visibleColumns,
    widths,
    colorMode,
    setColorMode,
    setVisibleIds,
    visibleIds,
    orderedColumns,
  } = useTableLayout(`certificates:${projectId}`, CERTIFICATE_COLUMNS);

  const [search, setSearch] = useState("");
  const [statusIds, setStatusIds] = useState<Set<string>>(new Set());
  const [counterpartyId, setCounterpartyId] = useState(
    initialCounterpartyId ?? "",
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fileFilter, setFileFilter] = useState<
    "any" | "has_file" | "no_file" | "signed_no_file"
  >("any");
  const [compact, setCompact] = useState(true);
  const [rowColorMode, setRowColorMode] = useState(false);
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" }>({
    id: "date",
    dir: "desc",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [formDefaults, setFormDefaults] =
    useState<CertificateFormDefaults | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = certificates.filter((c) => {
      if (counterpartyId && c.counterpartyId !== counterpartyId) return false;
      if (initialContractId && c.contractId !== initialContractId) return false;
      if (initialPaymentId && c.paymentId !== initialPaymentId) return false;
      if (statusIds.size && !statusIds.has(c.statusId)) return false;
      if (dateFrom && new Date(c.date).getTime() < new Date(dateFrom).getTime())
        return false;
      if (
        dateTo &&
        new Date(c.date).getTime() > new Date(dateTo).getTime() + 86400000
      )
        return false;
      const hasFile = c.files.length > 0;
      if (fileFilter === "has_file" && !hasFile) return false;
      if (fileFilter === "no_file" && hasFile) return false;
      if (fileFilter === "signed_no_file") {
        const signed =
          c.status.key === "SIGNED_ORIGINAL" ||
          c.status.key === "SIGNED_SCAN" ||
          /подписан/i.test(c.status.name);
        if (!(signed && !hasFile)) return false;
      }
      if (!q) return true;
      const hay = [
        c.counterparty.name,
        c.company.name,
        c.number,
        c.contract?.number ?? "",
        c.payment?.comment ?? "",
        c.summary ?? "",
        c.comment ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    rows = [...rows].sort((a, b) => {
      const cmp = cellValue(a, sort.id).localeCompare(cellValue(b, sort.id), "ru", {
        numeric: true,
      });
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [
    certificates,
    search,
    counterpartyId,
    statusIds,
    dateFrom,
    dateTo,
    fileFilter,
    sort,
    initialContractId,
    initialPaymentId,
  ]);

  function openCreate(prefill?: Partial<CertificateFormDefaults>) {
    setFormDefaults({
      statusId: defaultStatusId,
      companyId: initialCompanyId,
      counterpartyId: initialCounterpartyId,
      contractId: initialContractId,
      paymentId: initialPaymentId,
      ...prefill,
    });
    setModalOpen(true);
  }

  function openEdit(row: CertificateListItem) {
    setFormDefaults({
      id: row.id,
      date: new Date(row.date).toISOString().slice(0, 10),
      number: row.number,
      companyId: row.companyId,
      counterpartyId: row.counterpartyId,
      contractId: row.contractId,
      paymentId: row.paymentId,
      amount: Number(row.amount),
      vatEnabled: row.vatEnabled,
      vatRate: row.vatRate != null ? Number(row.vatRate) : 22,
      statusId: row.statusId,
      summary: row.summary,
      comment: row.comment,
    });
    setModalOpen(true);
  }

  function openCopy(row: CertificateListItem) {
    openCreate({
      date: new Date().toISOString().slice(0, 10),
      number: `${row.number}-копия`,
      companyId: row.companyId,
      counterpartyId: row.counterpartyId,
      contractId: row.contractId,
      paymentId: null,
      amount: Number(row.amount),
      vatEnabled: row.vatEnabled,
      vatRate: row.vatRate != null ? Number(row.vatRate) : 22,
      statusId: defaultStatusId,
      summary: row.summary,
      comment: row.comment,
    });
  }

  const exportRows =
    selected.size > 0
      ? filtered.filter((r) => selected.has(r.id))
      : filtered;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по контрагенту, договору, платежу…"
          className="max-w-sm"
        />
        {canWrite && !hideCreate ? (
          <Button type="button" onClick={() => openCreate()}>
            Добавить акт
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => setColumnsOpen((v) => !v)}
        >
          Столбцы
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setCompact((v) => !v)}
        >
          {compact ? "Расширенный" : "Компактный"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setRowColorMode((v) => !v)}
        >
          Цвет: {rowColorMode ? "строка" : "статус"}
        </Button>
        <label className="flex items-center gap-2 text-sm text-[var(--muted-fg)]">
          <input
            type="checkbox"
            checked={colorMode}
            onChange={(e) => setColorMode(e.target.checked)}
          />
          Цвета статусов
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void exportCertificatesXls(certificates, projectId, "all")
            }
          >
            Excel: всё
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void exportCertificatesXls(filtered, projectId, "filtered")
            }
          >
            Excel: фильтр
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={exportRows.length === 0}
            onClick={() =>
              void exportCertificatesXls(
                exportRows,
                projectId,
                selected.size ? "selected" : "filtered",
              )
            }
          >
            Excel: отмеченные
          </Button>
        </div>
      </div>

      {columnsOpen ? (
        <div className="flex flex-wrap gap-3 rounded-xl border border-[var(--border)] p-3 text-sm">
          {orderedColumns.map((col) => (
            <label key={col.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={visibleIds.has(col.id)}
                onChange={(e) => {
                  setVisibleIds((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(col.id);
                    else next.delete(col.id);
                    return next;
                  });
                }}
              />
              {col.label}
            </label>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-3 text-sm">
        <div>
          <p className="mb-1 text-xs text-[var(--muted-fg)]">Даты</p>
          <div className="flex gap-2">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
        {!initialCounterpartyId ? (
          <div>
            <p className="mb-1 text-xs text-[var(--muted-fg)]">Контрагент</p>
            <select
              className="glass-input rounded-xl px-2 py-2 text-sm"
              value={counterpartyId}
              onChange={(e) => setCounterpartyId(e.target.value)}
            >
              <option value="">Все</option>
              {counterparties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <p className="mb-1 text-xs text-[var(--muted-fg)]">Файлы</p>
          <select
            className="glass-input rounded-xl px-2 py-2 text-sm"
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value as typeof fileFilter)}
          >
            <option value="any">Любые</option>
            <option value="has_file">Файл есть</option>
            <option value="no_file">Файла нет</option>
            <option value="signed_no_file">Подписан, файла нет</option>
          </select>
        </div>
        <div className="min-w-[12rem]">
          <p className="mb-1 text-xs text-[var(--muted-fg)]">Статусы</p>
          <div className="flex flex-wrap gap-2">
            {statuses.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={statusIds.has(s.id)}
                  onChange={(e) => {
                    setStatusIds((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    });
                  }}
                />
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--panel-solid)] text-left">
              <th className="w-10 px-2 py-2">
                <input
                  type="checkbox"
                  checked={
                    filtered.length > 0 &&
                    filtered.every((r) => selected.has(r.id))
                  }
                  onChange={(e) => {
                    setSelected(
                      e.target.checked
                        ? new Set(filtered.map((r) => r.id))
                        : new Set(),
                    );
                  }}
                />
              </th>
              {visibleColumns.map((col) => (
                <th
                  key={col.id}
                  style={{ width: widths[col.id] ?? col.defaultWidth }}
                  className="cursor-pointer select-none px-2 py-2 font-medium"
                  onClick={() =>
                    setSort((prev) =>
                      prev.id === col.id
                        ? { id: col.id, dir: prev.dir === "asc" ? "desc" : "asc" }
                        : { id: col.id, dir: "asc" },
                    )
                  }
                >
                  {col.label}
                  {sort.id === col.id ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
              {canWrite ? <th className="w-28 px-2 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                style={
                  colorMode && rowColorMode
                    ? { backgroundColor: `${row.status.color}22` }
                    : undefined
                }
                className={cn(
                  "border-b border-[var(--border)]/50",
                  compact ? "align-middle" : "align-top",
                )}
              >
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={(e) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(row.id);
                        else next.delete(row.id);
                        return next;
                      });
                    }}
                  />
                </td>
                {visibleColumns.map((col) => (
                  <td
                    key={col.id}
                    className={cn("px-2", compact ? "py-1.5" : "py-2.5", "truncate")}
                    style={{ maxWidth: widths[col.id] ?? col.defaultWidth }}
                    title={cellValue(row, col.id)}
                  >
                    {col.id === "status" && colorMode && !rowColorMode ? (
                      <Badge
                        className="border"
                        style={{
                          backgroundColor: `${row.status.color}33`,
                          borderColor: `${row.status.color}66`,
                          color: row.status.color,
                        }}
                      >
                        {row.status.name}
                      </Badge>
                    ) : (
                      cellValue(row, col.id)
                    )}
                  </td>
                ))}
                {canWrite ? (
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <Button type="button" variant="ghost" onClick={() => openEdit(row)}>
                      Изменить
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => openCopy(row)}>
                      На основе
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + 2}
                  className="px-4 py-8 text-center text-[var(--muted-fg)]"
                >
                  Актов нет
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {canWrite ? (
        <CertificateFormModal
          key={
            formDefaults?.id ??
            formDefaults?.paymentId ??
            formDefaults?.number ??
            "new"
          }
          projectId={projectId}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          companies={companies}
          counterparties={counterparties}
          contracts={contracts}
          payments={payments}
          statuses={statuses}
          defaults={formDefaults}
          defaultStatusId={defaultStatusId}
          lockCompany={Boolean(initialCompanyId || initialPaymentId)}
          lockCounterparty={Boolean(initialCounterpartyId || initialPaymentId)}
          lockContract={Boolean(initialContractId)}
          lockPayment={Boolean(initialPaymentId)}
        />
      ) : null}

      {canWrite && hideCreate ? (
        <div className="flex justify-end">
          <Button type="button" onClick={() => openCreate()}>
            Добавить акт
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated */
export const ActsWorkspace = CertificatesWorkspace;
