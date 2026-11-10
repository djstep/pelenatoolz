import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateDepartmentBudgetButton } from "@/features/smeta/components/create-department-budget-button";
import { BudgetDepartmentView } from "@/features/smeta/components/budget-department-view";
import { getDepartmentDraftsBook } from "@/features/smeta/queries";
import { getDepartmentItemsTree, getItemsDictionaries } from "@/features/smeta/items-queries";
import {
  getBudgetApprovalInfo,
  getVariableChangesSinceApproval,
  listRecalcCandidates,
} from "@/features/smeta/approval-queries";
import { getBudgetDriveButton } from "@/features/smeta/drive-queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  canApproveSmeta,
  canEditBudgetDictionaries,
  canEditDepartmentSmeta,
  canReadDepartmentSmeta,
} from "@/features/smeta/lib/smeta-access";
import { prisma } from "@/shared/db/prisma";
import { Card } from "@/shared/ui/card";

// Vercel (Fluid compute, потолок 300 с): выгрузка сметы на диск (до 50 с) и пересчёт доступов к папке
// после ответа (`after()`, до 40 с) идут в одной функции — до 120 с.
export const maxDuration = 120;

type Props = {
  params: Promise<{ locale: string; projectId: string; departmentId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

/**
 * Смета цеха по статьям. Вкладка «Смета» — статьи, подстатьи и строки (правит глава цеха),
 * «Черновики» — листы Excel, в смету не входят. Старый табличный основной лист не показывается.
 */
export default async function DepartmentSmetaPage({ params, searchParams }: Props) {
  const { locale, projectId, departmentId } = await params;
  const { tab: tabParam } = await searchParams;
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
  const departmentHref = `${listHref}/${department.id}`;
  const budget = await prisma.budget.findFirst({
    where: { projectId, departmentId: department.id },
    select: { id: true, revision: true },
  });

  if (!budget) {
    return (
      <div className="space-y-6">
        <Link href={listHref} className="text-sm text-[var(--muted-fg)] hover:underline">
          ← Все сметы
        </Link>
        <Card>
          <h2 className="font-display text-[27px] font-bold leading-tight">Смета — {department.name}</h2>
          <p className="mt-2 text-sm text-[var(--muted-fg)]">Смета ещё не создана.</p>
          {canWrite ? (
            <div className="mt-4">
              <CreateDepartmentBudgetButton
                projectId={projectId}
                departmentId={department.id}
                href={departmentHref}
              />
            </div>
          ) : null}
        </Card>
      </div>
    );
  }

  const tab = tabParam === "drafts" ? "drafts" : "items";
  const [approvalInfo, variableChanges, recalc, driveButton, tree, dictionaries, drafts] = await Promise.all([
    getBudgetApprovalInfo(projectId, department.id),
    getVariableChangesSinceApproval(projectId, department.id),
    canApproveSmeta(ctx) ? listRecalcCandidates(projectId, [department.id]) : Promise.resolve([]),
    getBudgetDriveButton(ctx, department.id),
    tab === "items" ? getDepartmentItemsTree(projectId, department.id) : Promise.resolve(null),
    tab === "items" ? getItemsDictionaries(projectId, budget.id) : Promise.resolve(null),
    tab === "drafts" ? getDepartmentDraftsBook(projectId, department.id) : Promise.resolve(null),
  ]);

  return (
    <BudgetDepartmentView
      projectId={projectId}
      department={department}
      tab={tab}
      hrefs={{
        list: listHref,
        items: departmentHref,
        drafts: `${departmentHref}?tab=drafts`,
        settings: canEditBudgetDictionaries(ctx) ? `/${locale}/projects/${projectId}/finance/settings` : null,
      }}
      canWrite={canWrite}
      revision={budget.revision}
      approval={
        approvalInfo
          ? {
              info: approvalInfo,
              variableChanges,
              recalc: recalc[0] ?? null,
              timeZone: ctx.project.timezone,
              canApprove: canApproveSmeta(ctx),
              reviewHref: `${departmentHref}/review`,
              versionsHref: `${departmentHref}/versions`,
            }
          : undefined
      }
      driveButton={driveButton}
      items={tree && dictionaries ? { tree, dictionaries } : null}
      drafts={drafts}
    />
  );
}
