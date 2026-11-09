import Link from "next/link";
import type { BudgetVariable, ItemsDictionaries } from "@/features/smeta/items-queries";
import { formatNumber } from "@/features/smeta/lib/line-draft";

/**
 * Переменные проекта и формы оплаты в смете цеха — только просмотр. Их меняют продюсер и роль
 * с «Финансы: правка» в настройках финансов; глава цеха их здесь видит. Денег других цехов нет.
 */
export function BudgetItemsReference({
  variables,
  paymentForms,
  settingsHref,
}: {
  variables: BudgetVariable[];
  paymentForms: ItemsDictionaries["paymentForms"];
  /** Ссылка на настройки финансов — только тем, кто может их менять. */
  settingsHref: string | null;
}) {
  const forms = paymentForms.filter((f) => !f.archived);
  return (
    <details className="group rounded-xl border border-[var(--border)] bg-[var(--surface)]" data-budget-reference>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
        <span className="font-semibold">Переменные и формы оплаты</span>
        <span className="text-xs text-[var(--muted-fg)]">только просмотр</span>
        <span className="ml-auto text-xs text-[var(--accent)] group-open:hidden">Показать</span>
        <span className="ml-auto hidden text-xs text-[var(--accent)] group-open:inline">Скрыть</span>
      </summary>
      <div className="grid gap-4 border-t border-[var(--border)] px-4 py-3 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold text-[var(--muted-fg)]">Переменные проекта</h4>
          <ul className="mt-1.5 space-y-1 text-sm">
            {variables.map((v) => (
              <li key={v.id} className="flex justify-between gap-3" data-budget-variable={v.label}>
                <span>{v.label}</span>
                <span className={v.value == null ? "text-[var(--muted-fg)]" : "tabular-nums"}>
                  {v.value == null ? "не задана" : formatNumber(v.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-[var(--muted-fg)]">Формы оплаты · налог по умолчанию</h4>
          <ul className="mt-1.5 space-y-1 text-sm">
            {forms.map((f) => (
              <li key={f.id} className="flex justify-between gap-3">
                <span>{f.name}</span>
                <span className="tabular-nums">
                  {f.defaultTaxPercent == null ? "—" : `${formatNumber(f.defaultTaxPercent)} %`}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {settingsHref ? (
          <p className="text-xs text-[var(--muted-fg)] sm:col-span-2">
            Значения меняются в{" "}
            <Link href={settingsHref} className="text-[var(--accent)] hover:underline">
              настройках финансов
            </Link>
            .
          </p>
        ) : null}
      </div>
    </details>
  );
}
