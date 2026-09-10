"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ContractFormModal,
  type ContractFormDefaults,
} from "@/features/contracts/components/contract-form-modal";
import { exportContractsXls } from "@/features/contracts/lib/export-contracts-xls";
import { CONTRACT_COLUMNS } from "@/features/contracts/lib/table-columns";
import type { ContractListItem } from "@/features/contracts/queries";
import { useTableLayout } from "@/shared/hooks/use-table-layout";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";

type StatusOpt = { id: string; name: string; color: string };
type LedgerOpt = { id: string; name: string };
type EntityOpt = { id: string; name: string };

function money(n: number | string | { toString(): string } | null | undefined) {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : Number(n.toString());
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2 });
}

function cellValue(row: ContractListItem, colId: string): string {
  switch (colId) {
    case "date":
      return formatDateShort(row.date);
    case "number":
      return row.number;
    case "counterparty":
      return row.counterparty.name;
    case "company":
      return row.company.name;
    case "ledgerType":
      return row.ledgerType?.name ?? "—";
    case "amount":
      return money(row.amount);
    case "amountWithVat":
      return money(row.amountWithVat);
    case "status":
      return row.status.name;
    case "summary":
      return row.summary ?? "—";
    case "tags":
      return row.tags.join(", ") || "—";
    case "files":
      return String(row.files.length);
    default:
      return "";
  }
}

export function ContractsWorkspace({
  projectId,
  locale,
  contracts,
  companies,
  counterparties,
  ledgerTypes,
  statuses,
  existingTags,
  defaultStatusId,
  canWrite,
  initialCounterpartyId,
}: {
  projectId: string;
  locale: string;
  contracts: ContractListItem[];
  companies: EntityOpt[];
  counterparties: EntityOpt[];
  ledgerTypes: LedgerOpt[];
  statuses: StatusOpt[];
  existingTags: string[];
  defaultStatusId: string;
  canWrite: boolean;
  initialCounterpartyId?: string;
}) {
  const router = useRouter();
  const {
    visibleColumns,
    widths,
    colorMode,
    setColorMode,
    setVisibleIds,
    visibleIds,
    orderedColumns,
  } = useTableLayout(`contracts:${projectId}`, CONTRACT_COLUMNS);

  const [search, setSearch] = useState("");
  const [statusIds, setStatusIds] = useState<Set<string>>(new Set());
  const [ledgerIds, setLedgerIds] = useState<Set<string>>(new Set());
  const [counterpartyId, setCounterpartyId] = useState(
    initialCounterpartyId ?? "",
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fileFilter, setFileFilter] = useState<
    "any" | "has_original" | "has_scan" | "signed_no_scan"
  >("any");
  const [compact, setCompact] = useState(true);
  const [rowColorMode, setRowColorMode] = useState(false);
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" }>({
    id: "date",
    dir: "desc",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [formDefaults, setFormDefaults] = useState<ContractFormDefaults | null>(
    null,
  );
  const [columnsOpen, setColumnsOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = contracts.filter((c) => {
      if (counterpartyId && c.counterpartyId !== counterpartyId) return false;
      if (statusIds.size && !statusIds.has(c.statusId)) return false;
      if (ledgerIds.size && (!c.ledgerTypeId || !ledgerIds.has(c.ledgerTypeId)))
        return false;
      if (dateFrom) {
        const d = new Date(c.date).getTime();
        if (d < new Date(dateFrom).getTime()) return false;
      }
      if (dateTo) {
        const d = new Date(c.date).getTime();
        if (d > new Date(dateTo).getTime() + 86400000) return false;
      }
      const hasOriginal = c.files.some((f) => f.role === "ORIGINAL");
      const hasScan = c.files.some((f) => f.role === "SCAN");
      if (fileFilter === "has_original" && !hasOriginal) return false;
      if (fileFilter === "has_scan" && !hasScan) return false;
      if (fileFilter === "signed_no_scan") {
        const signed =
          c.status.key === "SIGNED_ORIGINAL" ||
          c.status.key === "SIGNED_SCAN" ||
          /подписан/i.test(c.status.name);
        if (!(signed && hasOriginal && !hasScan)) return false;
      }
      if (!q) return true;
      const hay = [
        c.counterparty.name,
        c.company.name,
        c.number,
        c.summary ?? "",
        c.comment ?? "",
        c.tags.join(" "),
        c.creditsName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    rows = [...rows].sort((a, b) => {
      const av = cellValue(a, sort.id);
      const bv = cellValue(b, sort.id);
      const cmp = av.localeCompare(bv, "ru", { numeric: true });
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [
    contracts,
    search,
    counterpartyId,
    statusIds,
    ledgerIds,
    dateFrom,
    dateTo,
    fileFilter,
    sort,
  ]);

  function toggleSort(id: string) {
    setSort((prev) =>
      prev.id === id
        ? { id, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { id, dir: "asc" },
    );
  }

  function openCreate(prefill?: Partial<ContractFormDefaults>) {
    setFormDefaults({
      statusId: defaultStatusId,
      counterpartyId: initialCounterpartyId,
      ...prefill,
    });
    setModalOpen(true);
  }

  function openCopy(row: ContractListItem) {
    openCreate({
      date: new Date().toISOString().slice(0, 10),
      number: `${row.number}-копия`,
      companyId: row.companyId,
      counterpartyId: row.counterpartyId,
      ledgerTypeId: row.ledgerTypeId,
      amount: Number(row.amount),
      vatEnabled: row.vatEnabled,
      vatRate: row.vatRate != null ? Number(row.vatRate) : 22,
      isPreliminary: row.isPreliminary,
      statusId: defaultStatusId,
      tags: row.tags,
      summary: row.summary,
      comment: row.comment,
      creditsName: row.creditsName,
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
          placeholder="Поиск…"
          className="max-w-xs"
        />
        {canWrite ? (
          <Button type="button" onClick={() => openCreate()}>
            Добавить договор
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
            onClick={() => void exportContractsXls(contracts, projectId, "all")}
          >
            Excel: всё
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void exportContractsXls(filtered, projectId, "filtered")
            }
          >
            Excel: фильтр
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={exportRows.length === 0}
            onClick={() =>
              void exportContractsXls(
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
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
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
        <div>
          <p className="mb-1 text-xs text-[var(--muted-fg)]">Файлы</p>
          <select
            className="glass-input rounded-xl px-2 py-2 text-sm"
            value={fileFilter}
            onChange={(e) =>
              setFileFilter(e.target.value as typeof fileFilter)
            }
          >
            <option value="any">Любые</option>
            <option value="has_original">Есть оригинал</option>
            <option value="has_scan">Есть скан</option>
            <option value="signed_no_scan">Подписан, скана нет</option>
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
        <div className="min-w-[10rem]">
          <p className="mb-1 text-xs text-[var(--muted-fg)]">Ведомости</p>
          <div className="flex flex-wrap gap-2">
            {ledgerTypes.map((t) => (
              <label key={t.id} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={ledgerIds.has(t.id)}
                  onChange={(e) => {
                    setLedgerIds((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(t.id);
                      else next.delete(t.id);
                      return next;
                    });
                  }}
                />
                {t.name}
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
                  onClick={() => toggleSort(col.id)}
                >
                  {col.label}
                  {sort.id === col.id ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
              {canWrite ? <th className="w-28 px-2 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const statusStyle = colorMode
                ? {
                    backgroundColor: rowColorMode
                      ? `${row.status.color}22`
                      : undefined,
                  }
                : undefined;
              return (
                <tr
                  key={row.id}
                  style={statusStyle}
                  className={cn(
                    "border-b border-[var(--border)]/50 cursor-pointer hover:bg-white/[0.03]",
                    row.isPreliminary && "text-[var(--muted-fg)]",
                    compact ? "align-middle" : "align-top",
                  )}
                  onClick={(e) => {
                    if (
                      (e.target as HTMLElement).closest("input, button, a")
                    )
                      return;
                    router.push(
                      `/${locale}/projects/${projectId}/counterparties/contracts/${row.id}`,
                    );
                  }}
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
                      className={cn(
                        "px-2",
                        compact ? "py-1.5" : "py-2.5",
                        col.id !== "status" && "truncate",
                      )}
                      style={{
                        maxWidth: widths[col.id] ?? col.defaultWidth,
                      }}
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
                    <td className="px-2 py-1.5 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => openCopy(row)}
                      >
                        На основе
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + 2}
                  className="px-4 py-8 text-center text-[var(--muted-fg)]"
                >
                  Договоров нет
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {canWrite ? (
        <ContractFormModal
          key={formDefaults?.id ?? formDefaults?.number ?? "new"}
          projectId={projectId}
          locale={locale}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          companies={companies}
          counterparties={counterparties}
          ledgerTypes={ledgerTypes}
          statuses={statuses}
          existingTags={existingTags}
          defaults={formDefaults}
          defaultStatusId={defaultStatusId}
        />
      ) : null}
    </div>
  );
}
