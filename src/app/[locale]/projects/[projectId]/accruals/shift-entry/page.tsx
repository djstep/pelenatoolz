import { ShiftEntryWorkspace } from "@/features/accruals/components/shift-entry-workspace";
import {
  listShiftEntryBudgetLines,
  listShootDaysBrief,
} from "@/features/accruals/queries";
import { listCounterpartyOptions } from "@/features/counterparties/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import Link from "next/link";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ShiftEntryPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const [lines, counterparties, shootDays] = await Promise.all([
    listShiftEntryBudgetLines(projectId),
    listCounterpartyOptions(projectId),
    listShootDaysBrief(projectId),
  ]);

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
          Выберите день смены, отметьте строки и сохраните пакетом
        </p>
      </div>

      <ShiftEntryWorkspace
        projectId={projectId}
        lines={lines}
        counterparties={counterparties}
        shootDays={shootDays}
        canWrite={ctx.can("finance:write")}
      />
    </div>
  );
}
