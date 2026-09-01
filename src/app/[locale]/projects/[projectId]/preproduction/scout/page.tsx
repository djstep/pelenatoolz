import { ScoutWorkspace } from "@/features/scout/components/scout-workspace";
import { listScoutCandidates } from "@/features/scout/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ScoutPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [candidates, locations] = await Promise.all([
    listScoutCandidates(projectId),
    prisma.location.findMany({
      where: { projectId },
      select: { id: true, name: true, sublocation: true },
      orderBy: [{ name: "asc" }, { sublocation: "asc" }],
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Скаут</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Реальные площадки-кандидаты для игровых локаций.
        </p>
      </div>
      <Card>
        <ScoutWorkspace
          projectId={projectId}
          locale={locale}
          candidates={candidates}
          locations={locations}
          canWrite={ctx.can("script:write")}
        />
      </Card>
    </div>
  );
}
