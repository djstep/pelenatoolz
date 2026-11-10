import Link from "next/link";
import { notFound } from "next/navigation";
import { getDepartmentVersion } from "@/features/smeta/approval-queries";
import { BudgetDriveExport } from "@/features/smeta/components/budget-drive-export";
import { BudgetExcelExportButton } from "@/features/smeta/components/budget-excel-export-button";
import { getBudgetDriveButton } from "@/features/smeta/drive-queries";
import { BudgetItemsVersionView } from "@/features/smeta/components/budget-items-version-view";
import { BudgetVersionView } from "@/features/smeta/components/budget-version-view";
import { formatRub } from "@/features/smeta/lib/money";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canReadDepartmentSmeta } from "@/features/smeta/lib/smeta-access";
import { prisma } from "@/shared/db/prisma";
import { formatDateTimeShort } from "@/shared/i18n/format-date";

// Vercel (Fluid compute, потолок 300 с): выгрузка сметы на диск (до 50 с) и пересчёт доступов к папке
// после ответа (`after()`, до 40 с) идут в одной функции — до 120 с.
export const maxDuration = 120;

type Props = {
  params: Promise<{ locale: string; projectId: string; departmentId: string; number: string }>;
};

export default async function BudgetVersionPage({ params }: Props) {
  const { locale, projectId, departmentId, number } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!canReadDepartmentSmeta(ctx, departmentId)) notFound();
  const versionNumber = Number(number);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) notFound();
  const department = await prisma.department.findFirst({
    where: { id: departmentId, projectId },
    select: { id: true, name: true, codePrefix: true },
  });
  if (!department) notFound();

  const version = await getDepartmentVersion(projectId, department.id, versionNumber);
  if (!version) notFound();
  const versionsHref = `/${locale}/projects/${projectId}/smeta/${department.id}/versions`;
  const driveButton = await getBudgetDriveButton(ctx, department.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Link href={versionsHref} className="text-sm text-[var(--muted-fg)] hover:underline">
        ← Версии сметы
      </Link>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-[27px] font-bold leading-tight">
            Смета — {department.name} · версия {version.number}
          </h2>
          {/* Выгрузка версии по статьям — шаг 8 волны; пока — только старые версии. */}
          {version.format === "SHEET" ? (
            <div className="flex flex-wrap items-center gap-2">
              <BudgetExcelExportButton
                projectId={projectId}
                departmentId={department.id}
                version={version.number}
              />
              <BudgetDriveExport
                projectId={projectId}
                departmentId={department.id}
                button={driveButton}
                version={version.number}
              />
            </div>
          ) : null}
        </div>
        <p className="text-sm text-[var(--muted-fg)]">
          Утверждена {formatDateTimeShort(version.approvedAt)}, {version.approvedByName}
          {version.approvedByHead ? " (утвердил глава цеха)" : ""}.{" "}
          {version.format === "ITEMS" ? "Строк" : "Статей"}: {version.itemCount},
          итого {formatRub(version.total)}. Только чтение — версию нельзя изменить.
        </p>
        {version.recalcByVariables ? (
          <p className="text-sm text-[var(--tone-warning)]" data-version-recalc>
            Пересчёт по переменным: строки не менялись, продюсер утвердил новые значения переменных без
            отправки главой.
          </p>
        ) : null}
        {version.submitComment ? (
          <p className="text-sm">
            Комментарий главы{version.submittedByName ? ` (${version.submittedByName})` : ""}:{" "}
            <span className="whitespace-pre-wrap">«{version.submitComment}»</span>
          </p>
        ) : null}
      </div>
      {version.format === "ITEMS" ? (
        <BudgetItemsVersionView snapshot={version.snapshot} />
      ) : (
        <BudgetVersionView
          projectId={projectId}
          department={department}
          sheetBook={version.sheetBook}
          lines={version.lines}
          total={version.total}
          title={`Версия ${version.number} — ${department.name}`}
          versionsHref={versionsHref}
        />
      )}
    </div>
  );
}
