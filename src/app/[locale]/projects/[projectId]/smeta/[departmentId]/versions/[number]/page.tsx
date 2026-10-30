import Link from "next/link";
import { notFound } from "next/navigation";
import { getDepartmentVersion } from "@/features/smeta/approval-queries";
import { BudgetVersionView } from "@/features/smeta/components/budget-version-view";
import { formatRub } from "@/features/smeta/lib/money";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canReadDepartmentSmeta } from "@/features/smeta/lib/smeta-access";
import { prisma } from "@/shared/db/prisma";
import { formatDateTimeShort } from "@/shared/i18n/format-date";

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Link href={versionsHref} className="text-sm text-[var(--muted-fg)] hover:underline">
        ← Версии сметы
      </Link>
      <div className="space-y-1">
        <h2 className="font-display text-2xl font-semibold">
          Смета — {department.name} · версия {version.number}
        </h2>
        <p className="text-sm text-[var(--muted-fg)]">
          Утверждена {formatDateTimeShort(version.approvedAt)}, {version.approvedByName}
          {version.approvedByHead ? " (утвердил глава цеха)" : ""}. Статей: {version.itemCount},
          итого {formatRub(version.total)}. Только чтение — версию нельзя изменить.
        </p>
        {version.submitComment ? (
          <p className="text-sm">
            Комментарий главы{version.submittedByName ? ` (${version.submittedByName})` : ""}:{" "}
            <span className="whitespace-pre-wrap">«{version.submitComment}»</span>
          </p>
        ) : null}
      </div>
      <BudgetVersionView
        projectId={projectId}
        department={department}
        sheetBook={version.sheetBook}
        lines={version.lines}
        total={version.total}
        title={`Версия ${version.number} — ${department.name}`}
        versionsHref={versionsHref}
      />
    </div>
  );
}
