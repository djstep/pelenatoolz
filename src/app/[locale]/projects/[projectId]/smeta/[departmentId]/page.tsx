import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateDepartmentBudgetButton } from "@/features/smeta/components/create-department-budget-button";
import { SmetaWorkspace } from "@/features/smeta/components/smeta-workspace";
import {
  checkDepartmentBudget,
  getDepartmentBudget,
  listDepartmentCodes,
} from "@/features/smeta/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  canEditDepartmentSmeta,
  canReadDepartmentSmeta,
} from "@/features/smeta/lib/smeta-access";
import { prisma } from "@/shared/db/prisma";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string; departmentId: string }>;
};

export default async function DepartmentSmetaPage({ params }: Props) {
  const { locale, projectId, departmentId } = await params;
  const ctx = await requireProjectContext(projectId);

  // Нет цеха в проекте и нет доступа — одинаково «не найдено».
  if (!canReadDepartmentSmeta(ctx, departmentId)) notFound();
  const department = await prisma.department.findFirst({
    where: { id: departmentId, projectId },
    select: { id: true, name: true, codePrefix: true },
  });
  if (!department) notFound();

  const canWrite = canEditDepartmentSmeta(ctx, department.id);
  const listHref = `/${locale}/projects/${projectId}/smeta`;
  const budget = await getDepartmentBudget(projectId, department.id);

  if (!budget) {
    return (
      <div className="space-y-6">
        <Link href={listHref} className="text-sm text-[var(--muted-fg)] hover:underline">
          ← Все сметы
        </Link>
        <Card>
          <h2 className="font-display text-xl font-semibold">Смета — {department.name}</h2>
          <p className="mt-2 text-sm text-[var(--muted-fg)]">Смета ещё не создана.</p>
          {canWrite ? (
            <div className="mt-4">
              <CreateDepartmentBudgetButton
                projectId={projectId}
                departmentId={department.id}
                href={`${listHref}/${department.id}`}
              />
            </div>
          ) : null}
        </Card>
      </div>
    );
  }

  const [checks, usedCodes] = await Promise.all([
    checkDepartmentBudget(projectId, budget),
    canWrite ? listDepartmentCodes(projectId, department.id) : Promise.resolve([]),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <SmetaWorkspace
        projectId={projectId}
        department={department}
        budget={budget}
        canWrite={canWrite}
        initialChecks={checks}
        usedCodes={usedCodes}
        listHref={listHref}
      />
    </div>
  );
}
