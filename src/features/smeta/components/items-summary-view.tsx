"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTransition, type ReactNode } from "react";
import { BudgetSummaryDriveExport } from "@/features/smeta/components/budget-summary-drive-export";
import { useCollapsedIds } from "@/features/smeta/components/use-collapsed-ids";
import type { BudgetDriveButton } from "@/features/smeta/drive-queries";
import { exportSummaryBookAction } from "@/features/smeta/export-actions";
import type { ItemsSummary, SummaryLine, SummaryMoney, SummarySub } from "@/features/smeta/items-summary-queries";
import { downloadBase64Xlsx } from "@/features/smeta/lib/download-xlsx";
import { formatMoney, formatNumber } from "@/features/smeta/lib/line-draft";
import { cn } from "@/shared/lib/cn";
import { countOf } from "@/shared/lib/plural";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "черновик",
  SUBMITTED: "на утверждении",
  APPROVED: "утверждена",
  RETURNED: "возвращена",
};

const money = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

function MoneyCells({ totals, strong }: { totals: SummaryMoney; strong?: boolean }) {
  return (
    <>
      <td className={money}>{formatMoney(totals.amount)}</td>
      <td className={money}>{formatMoney(totals.tax)}</td>
      <td className={cn(money, strong && "font-semibold")}>{formatMoney(totals.total)}</td>
    </>
  );
}

function Chevron({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted-fg)] hover:bg-[var(--nav-hover-bg)]"
      aria-expanded={open}
      aria-label={open ? `Свернуть: ${label}` : `Развернуть: ${label}`}
      onClick={onClick}
    >
      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  );
}

/** Строка уровня: шеврон, название, пометка, итоги. Колонки строк (кол-во, ставка, множители) пусты. */
function LevelRow({
  depth,
  id,
  name,
  note,
  totals,
  open,
  toggle,
  strong,
  attrs,
}: {
  depth: number;
  id: string;
  name: string;
  note?: ReactNode;
  totals: SummaryMoney;
  open: boolean;
  toggle: (id: string) => void;
  strong?: boolean;
  attrs?: Record<string, string>;
}) {
  return (
    <tr
      className={cn(
        "border-b border-[var(--border)]/60",
        depth === 0 ? "bg-[var(--surface-2)]" : depth === 1 ? "bg-[var(--surface-2)]/60" : "",
      )}
      {...attrs}
    >
      <td className="py-1.5 pr-2" style={{ paddingLeft: 4 + depth * 20 }} colSpan={4}>
        <div className="flex min-w-0 items-center gap-1.5">
          <Chevron open={open} onClick={() => toggle(id)} label={name} />
          <span className={cn("truncate", depth === 0 ? "font-semibold" : "font-medium")}>{name}</span>
          {note}
        </div>
      </td>
      <MoneyCells totals={totals} strong={strong} />
    </tr>
  );
}

function LineRows({ lines, depth }: { lines: SummaryLine[]; depth: number }) {
  return (
    <>
      {lines.map((l) => (
        <tr key={l.id} className="border-b border-[var(--border)]/60 align-top" data-summary-line={l.name}>
          <td className="py-1.5 pr-2" style={{ paddingLeft: 4 + depth * 20 + 30 }}>
            {l.name}
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums">
            {l.quantity == null ? "—" : formatNumber(l.quantity)}
            {l.unit ? <span className="block text-xs text-[var(--muted-fg)]">{l.unit}</span> : null}
          </td>
          <td className={money}>{l.rate == null ? "—" : formatMoney(l.rate)}</td>
          <td className="px-2 py-1.5 text-xs">{l.multipliers || "—"}</td>
          {l.total == null ? (
            <td colSpan={3} className="px-2 py-1.5 text-right text-xs text-[var(--tone-warning)]">
              без суммы — не вошла в итог
            </td>
          ) : (
            <MoneyCells totals={{ amount: l.amount ?? "0", tax: l.tax ?? "0", total: l.total }} />
          )}
        </tr>
      ))}
    </>
  );
}

function SubRows({
  sub,
  idPrefix,
  depth,
  opened,
  toggle,
}: {
  sub: SummarySub;
  idPrefix: string;
  depth: number;
  opened: Set<string>;
  toggle: (id: string) => void;
}) {
  const id = `${idPrefix}:s:${sub.id}`;
  const open = opened.has(id);
  return (
    <>
      <LevelRow depth={depth} id={id} name={sub.name} totals={sub.totals} open={open} toggle={toggle} />
      {open ? <LineRows lines={sub.lines} depth={depth} /> : null}
    </>
  );
}

/**
 * Сводная продюсера: по цехам или по статьям шаблона, раскрытие до подстатей и строк, итоги на
 * каждом уровне; раскрытые уровни запоминаются в браузере. Внизу — резерв и агентские
 * отдельными строками и итог по проекту. Кодов на экране нет.
 */
export function ItemsSummaryView({
  projectId,
  summary,
  view,
  hrefs,
  driveButton,
  recalcPanel,
}: {
  projectId: string;
  summary: ItemsSummary;
  view: "departments" | "articles";
  hrefs: { versions: string; drafts: string; departments: string; articles: string };
  driveButton: BudgetDriveButton | null;
  recalcPanel?: ReactNode;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const drafts = summary.mode === "drafts";
  // Набор — раскрытые уровни: по умолчанию сводная свёрнута до цехов (статей).
  const [opened, toggle] = useCollapsedIds(`smeta-summary-open:${projectId}:${summary.mode}:${view}`);
  const tab = (active: boolean) =>
    cn(
      "rounded-md px-3 py-1 text-sm",
      active ? "bg-[var(--surface)] font-semibold shadow-sm" : "text-[var(--muted-fg)] hover:text-[var(--foreground)]",
    );

  let body: ReactNode;
  if (view === "departments") {
    body = summary.departments.map((d) => {
      const id = `d:${d.id}`;
      const open = opened.has(id);
      const note = (
        <span className="text-xs whitespace-nowrap text-[var(--muted-fg)]">
          {drafts
            ? d.status
              ? STATUS_LABEL[d.status]
              : "сметы нет"
            : d.versionNumber
              ? `версия ${d.versionNumber}`
              : "нет утверждённой версии"}
          {d.incomplete > 0 ? (
            <span className="ml-2 text-[var(--tone-warning)]">
              {countOf(d.incomplete, ["строка", "строки", "строк"])} без суммы
            </span>
          ) : null}
        </span>
      );
      return (
        <DepartmentRows key={d.id}>
          <LevelRow depth={0} id={id} name={d.name} note={note} totals={d.totals} open={open} toggle={toggle} strong attrs={{ "data-summary-department": d.name }} />
          {open
            ? d.articles.map((a) => {
                const aid = `${id}:a:${a.key}`;
                const aOpen = opened.has(aid);
                return (
                  <DepartmentRows key={a.key}>
                    <LevelRow depth={1} id={aid} name={a.name} totals={a.totals} open={aOpen} toggle={toggle} />
                    {aOpen
                      ? a.subarticles.map((s) => (
                          <SubRows key={s.id} sub={s} idPrefix={aid} depth={2} opened={opened} toggle={toggle} />
                        ))
                      : null}
                  </DepartmentRows>
                );
              })
            : null}
        </DepartmentRows>
      );
    });
  } else {
    body = summary.articles.map((a) => {
      const id = `a:${a.key}`;
      const open = opened.has(id);
      const note = (
        <span className="text-xs text-[var(--muted-fg)]">
          {countOf(a.departments.length, ["цех", "цеха", "цехов"])}
        </span>
      );
      return (
        <DepartmentRows key={a.key}>
          <LevelRow depth={0} id={id} name={a.name} note={note} totals={a.totals} open={open} toggle={toggle} strong attrs={{ "data-summary-article": a.name }} />
          {open
            ? a.departments.map((d) => {
                const did = `${id}:d:${d.id}`;
                const dOpen = opened.has(did);
                return (
                  <DepartmentRows key={d.id}>
                    <LevelRow depth={1} id={did} name={d.name} totals={d.totals} open={dOpen} toggle={toggle} />
                    {dOpen
                      ? d.subarticles.map((s) => (
                          <SubRows key={s.id} sub={s} idPrefix={did} depth={2} opened={opened} toggle={toggle} />
                        ))
                      : null}
                  </DepartmentRows>
                );
              })
            : null}
        </DepartmentRows>
      );
    });
  }
  const empty = view === "departments" ? summary.departments.length === 0 : summary.articles.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <nav className="inline-flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1" aria-label="Что показывать">
          <Link href={hrefs.versions} className={tab(!drafts)} aria-current={!drafts ? "page" : undefined}>
            Утверждённые версии
          </Link>
          <Link href={hrefs.drafts} className={tab(drafts)} aria-current={drafts ? "page" : undefined}>
            Черновики
          </Link>
        </nav>
        <nav className="inline-flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1" aria-label="Группировка">
          <Link href={hrefs.departments} className={tab(view === "departments")} aria-current={view === "departments" ? "page" : undefined}>
            По цехам
          </Link>
          <Link href={hrefs.articles} className={tab(view === "articles")} aria-current={view === "articles" ? "page" : undefined}>
            По статьям
          </Link>
        </nav>
        {/* Выгрузка — тот же расчёт, что на экране: «Свод», листы цехов с колонкой «Код». */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <BudgetSummaryDriveExport projectId={projectId} drafts={drafts} button={driveButton} />
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              start(async () => {
                const res = await exportSummaryBookAction(projectId, { drafts });
                if (res.error !== undefined) {
                  toast.error(res.error);
                  return;
                }
                downloadBase64Xlsx(res.base64, res.fileName);
                toast.success("Excel скачан");
              });
            }}
          >
            {pending ? "…" : "Экспорт Excel"}
          </Button>
        </div>
      </div>
      <p className="text-sm text-[var(--muted-fg)]">
        {drafts
          ? "Текущие черновики цехов: суммы пересчитаны по действующим значениям переменных."
          : "Последние утверждённые версии цехов — план проекта."}{" "}
        Все суммы с налогом; резерв и агентские — процент от итога по цехам.
      </p>

      {recalcPanel}

      <section className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[860px] table-fixed text-sm" aria-label="Сводная по сметам">
          <colgroup>
            <col />
            <col className="w-[96px]" />
            <col className="w-[112px]" />
            <col className="w-[176px]" />
            <col className="w-[124px]" />
            <col className="w-[112px]" />
            <col className="w-[132px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--glass-table-head)] text-left">
              <th className="py-2 pr-2 pl-3 font-semibold">{view === "departments" ? "Цех / статья / строка" : "Статья / цех / строка"}</th>
              <th className="px-2 py-2 text-right">Кол-во</th>
              <th className="px-2 py-2 text-right">Ставка</th>
              <th className="px-2 py-2">Множители</th>
              <th className="px-2 py-2 text-right">Сумма</th>
              <th className="px-2 py-2 text-right">Налог</th>
              <th className="px-2 py-2 text-right">Итого</th>
            </tr>
          </thead>
          <tbody>
            {empty ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--muted-fg)]">
                  {drafts ? "Смет цехов пока нет." : "Утверждённых версий пока нет — план проекта пуст."}
                </td>
              </tr>
            ) : (
              body
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--border)]" data-summary-subtotal>
              <td colSpan={4} className="py-2 pr-2 pl-3 font-semibold">
                Итого по цехам
              </td>
              <MoneyCells totals={summary.subtotal} strong />
            </tr>
            <tr className="border-t border-[var(--border)]/60" data-summary-reserve>
              <td colSpan={6} className="py-1.5 pr-2 pl-3">
                Резерв, {formatNumber(summary.reserve.percent)}% от итога с налогом
              </td>
              <td className={money}>{formatMoney(summary.reserve.amount)}</td>
            </tr>
            <tr className="border-t border-[var(--border)]/60" data-summary-agency>
              <td colSpan={6} className="py-1.5 pr-2 pl-3">
                Агентские, {formatNumber(summary.agency.percent)}% от итога с налогом
              </td>
              <td className={money}>{formatMoney(summary.agency.amount)}</td>
            </tr>
            <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-2)]" data-summary-total>
              <td colSpan={6} className="py-2.5 pr-2 pl-3 font-semibold">
                Итого по проекту
              </td>
              <td className={cn(money, "font-display text-base font-bold")}>{formatMoney(summary.total)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}

function DepartmentRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
