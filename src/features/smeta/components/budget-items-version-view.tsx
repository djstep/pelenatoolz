import { formatMoney, formatNumber } from "@/features/smeta/lib/line-draft";
import {
  snapshotMultipliersText,
  snapshotVariableIds,
  type ItemsSnapshot,
  type SnapshotTotals,
} from "@/features/smeta/lib/items-snapshot";
import { cn } from "@/shared/lib/cn";

const money = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

function TotalsCells({ totals, strong }: { totals: SnapshotTotals; strong?: boolean }) {
  return (
    <>
      <td className={money}>{formatMoney(totals.amount)}</td>
      <td className={money}>{formatMoney(totals.tax)}</td>
      <td className={cn(money, strong && "font-semibold")}>{formatMoney(totals.total)}</td>
    </>
  );
}

/**
 * Утверждённая версия сметы по статьям — только чтение: статьи → подстатьи → строки, суммы
 * и значения переменных на момент утверждения. Внутренних кодов на экране нет.
 */
export function BudgetItemsVersionView({ snapshot }: { snapshot: ItemsSnapshot }) {
  const used = snapshotVariableIds(snapshot);
  const variables = snapshot.variables.filter((v) => used.has(v.id));

  return (
    <div className="space-y-4">
      {variables.length > 0 ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm" data-version-variables>
          <h3 className="mb-1 font-semibold">Переменные на момент утверждения</h3>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {variables.map((v) => (
              <li key={v.id} data-version-variable={v.label}>
                {v.label}: <span className="tabular-nums">{v.value == null ? "не задана" : formatNumber(v.value)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[1040px] table-fixed text-sm xl:min-w-0" aria-label="Утверждённая версия">
          <colgroup>
            <col />
            <col className="w-[110px]" />
            <col className="w-[110px]" />
            <col className="w-[170px]" />
            <col className="w-[76px]" />
            <col className="w-[118px]" />
            <col className="w-[104px]" />
            <col className="w-[124px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--glass-table-head)] text-left">
              <th className="py-2 pr-2 pl-3 font-semibold">Наименование</th>
              <th className="px-2 py-2 text-right">Кол-во</th>
              <th className="px-2 py-2 text-right">Ставка</th>
              <th className="px-2 py-2">Множители</th>
              <th className="px-2 py-2 text-right">Налог, %</th>
              <th className="px-2 py-2 text-right">Сумма</th>
              <th className="px-2 py-2 text-right">Налог</th>
              <th className="px-2 py-2 text-right">Итого</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.articles.map((article) => (
              <ArticleRows key={article.id} article={article} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-2)]">
              <td colSpan={5} className="py-2.5 pr-2 pl-3 font-semibold">
                Итого по смете
              </td>
              <TotalsCells totals={snapshot.totals} strong />
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}

function ArticleRows({ article }: { article: ItemsSnapshot["articles"][number] }) {
  return (
    <>
      <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]" data-version-article={article.name}>
        <td colSpan={5} className="py-2 pr-2 pl-3 font-semibold">
          {article.name}
        </td>
        <TotalsCells totals={article.totals} strong />
      </tr>
      {article.subarticles.map((sub) => (
        <SubRows key={sub.id} sub={sub} />
      ))}
    </>
  );
}

function SubRows({ sub }: { sub: ItemsSnapshot["articles"][number]["subarticles"][number] }) {
  return (
    <>
      <tr className="border-b border-[var(--border)]/60 bg-[var(--surface-2)]/60" data-version-subarticle={sub.name}>
        <td colSpan={5} className="py-1.5 pr-2 pl-7 font-medium">
          {sub.name}
        </td>
        <TotalsCells totals={sub.totals} />
      </tr>
      {sub.lines.map((line) => {
        const details = [line.expenseType, line.paymentForm].filter(Boolean).join(" · ");
        return (
          <tr key={line.id} className="border-b border-[var(--border)]/60 align-top" data-version-line={line.name}>
            <td className="py-1.5 pr-2 pl-11">
              {line.name}
              {details ? <span className="block text-xs text-[var(--muted-fg)]">{details}</span> : null}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">
              {line.quantity == null ? "—" : formatNumber(line.quantity)}
              {line.unit ? <span className="block text-xs text-[var(--muted-fg)]">{line.unit}</span> : null}
            </td>
            <td className={money}>{line.rate == null ? "—" : formatMoney(line.rate)}</td>
            <td className="px-2 py-1.5 text-xs">{snapshotMultipliersText(line.multipliers) || "—"}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{line.taxPercent == null ? "—" : formatNumber(line.taxPercent)}</td>
            <td className={money}>{formatMoney(line.amount)}</td>
            <td className={money}>{formatMoney(line.tax)}</td>
            <td className={money}>{formatMoney(line.total)}</td>
          </tr>
        );
      })}
    </>
  );
}
