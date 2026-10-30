import Link from "next/link";
import { notFound } from "next/navigation";
import { listDepartmentVersions } from "@/features/smeta/approval-queries";
import { formatRub } from "@/features/smeta/lib/money";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canReadDepartmentSmeta } from "@/features/smeta/lib/smeta-access";
import { prisma } from "@/shared/db/prisma";
import { formatDateTimeShort } from "@/shared/i18n/format-date";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string; departmentId: string }>;
};

export default async function BudgetVersionsPage({ params }: Props) {
  const { locale, projectId, departmentId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!canReadDepartmentSmeta(ctx, departmentId)) notFound();
  const department = await prisma.department.findFirst({
    where: { id: departmentId, projectId },
    select: { id: true, name: true },
  });
  if (!department) notFound();

  const versions = await listDepartmentVersions(projectId, department.id);
  const departmentHref = `/${locale}/projects/${projectId}/smeta/${department.id}`;

  return (
    <div className="space-y-6">
      <Link href={departmentHref} className="text-sm text-[var(--muted-fg)] hover:underline">
        ← Смета цеха
      </Link>
      <h2 className="font-display text-2xl font-semibold">Версии сметы — {department.name}</h2>
      <Card>
        {versions.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">
            Утверждённых версий нет. План цеха пуст.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-[var(--muted-fg)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Версия</th>
                  <th className="px-3 py-2 font-medium">Утверждена</th>
                  <th className="px-3 py-2 font-medium">Кто утвердил</th>
                  <th className="px-3 py-2 text-right font-medium">Статей</th>
                  <th className="px-3 py-2 text-right font-medium">Итого</th>
                  <th className="px-3 py-2 font-medium">Комментарий главы</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v, index) => (
                  <tr key={v.number} className="border-t border-[var(--border)]/60 align-top">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`${departmentHref}/versions/${v.number}`}
                        className="font-medium hover:underline"
                      >
                        Версия {v.number}
                      </Link>
                      {index === 0 ? (
                        <span className="ml-2 text-xs text-[var(--muted-fg)]">план</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDateTimeShort(v.approvedAt)}
                    </td>
                    <td className="px-3 py-2">
                      {v.approvedByName}
                      {v.approvedByHead ? (
                        <span className="block text-xs text-[var(--muted-fg)]">
                          утвердил глава цеха
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">{v.itemCount}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatRub(v.total)}</td>
                    <td className="px-3 py-2 whitespace-pre-wrap text-[var(--muted-fg)]">
                      {v.submitComment ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
