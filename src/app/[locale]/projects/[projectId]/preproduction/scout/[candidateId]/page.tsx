import { notFound } from "next/navigation";
import { ScoutCandidateDetail } from "@/features/scout/components/scout-candidate-detail";
import {
  getScoutCandidate,
  listLocationsForScout,
} from "@/features/scout/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string; candidateId: string }>;
};

export default async function ScoutCandidatePage({ params }: Props) {
  const { locale, projectId, candidateId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [candidate, locations] = await Promise.all([
    getScoutCandidate(projectId, candidateId),
    listLocationsForScout(projectId),
  ]);

  if (!candidate) notFound();

  return (
    <div className="space-y-6">
      <Card>
        <ScoutCandidateDetail
          projectId={projectId}
          locale={locale}
          candidate={candidate}
          locations={locations}
          canWrite={ctx.can("script:write")}
        />
      </Card>
    </div>
  );
}
