import Link from "next/link";
import { CreateDepartmentBudgetButton } from "@/features/smeta/components/create-department-budget-button";
import { listDepartmentBudgetSummaries } from "@/features/smeta/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { listDepartmentsForSmeta } from "@/features/departments/queries";
import {
  canEditDepartmentSmeta,
  canOpenSmeta,
  canReadAllSmeta,
} from "@/features/smeta/lib/smeta-access";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

function formatRub(n: number) {
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

export default async function SmetaPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!canOpenSmeta(ctx)) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к сметам</p>;
  }

  // Глава видит только свои цеха, продюсер и флаг «Сметы — просмотр всех» — все.
  const departments = await listDepartmentsForSmeta(
    projectId,
    canReadAllSmeta(ctx) ? null : ctx.headDepartmentIds,
  );
  const summaries = await listDepartmentBudgetSummaries(
    projectId,
    departments.map((d) => d.id),
  );
  const base = `/${locale}/projects/${projectId}/smeta`;

  return (
    <div className="space-y-6">
      <h2 className="font-display text-2xl font-semibold">Сметы</h2>
      <Card>
        <h3 className="font-display text-lg font-semibold">Сметы цехов</h3>
        {departments.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted-fg)]">
            Цехов пока нет. Их создаёт продюсер в разделе «Настройки → Цеха».
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]/60">
            {departments.map((department) => {
              const summary = summaries.get(department.id);
              const href = `${base}/${department.id}`;
              return (
                <li
                  key={department.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <span className="flex items-center gap-3">
                    {summary ? (
                      <Link href={href} className="font-medium hover:underline">
                        {department.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{department.name}</span>
                    )}
                    <span className="font-mono text-xs text-[var(--muted-fg)]">
                      {department.codePrefix}
                    </span>
                  </span>
                  {summary ? (
                    <span className="flex flex-wrap items-center gap-3 text-[var(--muted-fg)]">
                      <span>статей: {summary.itemCount}</span>
                      <span className="font-medium text-[var(--foreground)]">
                        {formatRub(summary.total)}
                      </span>
                      <span className="text-xs">изменена {formatDateShort(summary.updatedAt)}</span>
                      <Link
                        href={href}
                        className="rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--foreground)] hover:bg-[var(--nav-hover-bg)]"
                      >
                        Открыть
                      </Link>
                    </span>
                  ) : canEditDepartmentSmeta(ctx, department.id) ? (
                    <CreateDepartmentBudgetButton
                      projectId={projectId}
                      departmentId={department.id}
                      href={href}
                    />
                  ) : (
                    <span className="rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted-fg)]">
                      смета ещё не создана
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
