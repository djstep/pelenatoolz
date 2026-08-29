import { notFound } from "next/navigation";
import { ActorEmploymentView } from "@/features/day-docs/components/actor-employment-view";
import { getShootDayDocument } from "@/features/day-docs/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string; dayId: string }>;
};

export default async function ActorEmploymentDayPage({ params }: Props) {
  const { locale, projectId, dayId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("cast:read") && !ctx.can("schedule:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к занятости актёров</p>
    );
  }

  const bundle = await getShootDayDocument(projectId, dayId);
  if (!bundle) notFound();

  return (
    <ActorEmploymentView
      locale={locale}
      projectId={projectId}
      bundle={bundle}
    />
  );
}
