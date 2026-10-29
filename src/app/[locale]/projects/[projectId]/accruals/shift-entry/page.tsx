import { ShiftEntryWorkspace } from "@/features/accruals/components/shift-entry-workspace";
import {
  listShiftEntryRows,
  listShootDaysBrief,
} from "@/features/accruals/queries";
import { listCounterpartyOptions } from "@/features/counterparties/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { listVisibleBudgetItems } from "@/features/smeta/budget-item-access";
import Link from "next/link";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ day?: string }>;
};

export default async function ShiftEntryPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const { day } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const [items, counterparties, shootDays] = await Promise.all([
    listVisibleBudgetItems(projectId, ctx),
    listCounterpartyOptions(projectId),
    listShootDaysBrief(projectId),
  ]);
  const shootDayId = shootDays.some((d) => d.id === day)
    ? day!
    : (shootDays[0]?.id ?? null);
  const rows = await listShiftEntryRows(
    projectId,
    shootDayId,
    new Set(items.map((i) => i.id)),
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--muted-fg)]">
          <Link
            href={`/${locale}/projects/${projectId}/accruals`}
            className="underline-offset-2 hover:underline"
          >
            ← Начисления
          </Link>
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold">
          Ввод посменных расходов
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Строки — актёры, ресурсы и объекты, у которых в карточке задана статья сметы по
          умолчанию. Выберите день, отметьте строки и сохраните пакетом.
        </p>
      </div>

      <ShiftEntryWorkspace
        key={shootDayId ?? "none"}
        locale={locale}
        projectId={projectId}
        rows={rows}
        items={items}
        counterparties={counterparties}
        shootDays={shootDays}
        shootDayId={shootDayId}
        canWrite={ctx.can("finance:write")}
      />
    </div>
  );
}
