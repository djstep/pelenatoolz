import Link from "next/link";
import { notFound } from "next/navigation";
import { compareDepartmentVersions } from "@/features/smeta/approval-queries";
import { BudgetDiffTable } from "@/features/smeta/components/budget-diff-table";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canReadDepartmentSmeta } from "@/features/smeta/lib/smeta-access";
import { prisma } from "@/shared/db/prisma";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string; departmentId: string }>;
  searchParams: Promise<{ a?: string; b?: string }>;
};

function versionNumber(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Сравнение двух утверждённых версий цеха: что добавлено, удалено, изменено. */
export default async function BudgetVersionsComparePage({ params, searchParams }: Props) {
  const { locale, projectId, departmentId } = await params;
  const { a, b } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!canReadDepartmentSmeta(ctx, departmentId)) notFound();
  const department = await prisma.department.findFirst({
    where: { id: departmentId, projectId },
    select: { id: true, name: true },
  });
  if (!department) notFound();
  const before = versionNumber(a);
  const after = versionNumber(b);
  if (before === null || after === null || before === after) notFound();
  // Раньше — старшая по номеру, чтобы «добавлено» значило добавлено позже.
  const result = await compareDepartmentVersions(projectId, department.id, Math.min(before, after), Math.max(before, after));
  if (!result) notFound();
  const versionsHref = `/${locale}/projects/${projectId}/smeta/${department.id}/versions`;

  return (
    <div className="space-y-6">
      <Link href={versionsHref} className="text-sm text-[var(--muted-fg)] hover:underline">
        ← Версии сметы
      </Link>
      <h2 className="font-display text-[27px] leading-tight font-bold">
        Версия {result.before} ↔ версия {result.after} — {department.name}
      </h2>
      <Card>
        <BudgetDiffTable diff={result.diff} beforeLabel={`версии ${result.before}`} />
      </Card>
    </div>
  );
}
