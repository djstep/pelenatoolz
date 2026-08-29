import { notFound } from "next/navigation";
import { CallSheetView } from "@/features/day-docs/components/call-sheet-view";
import { fetchCityAstro } from "@/features/day-docs/lib/city-astro";
import {
  getNextShootDayBrief,
  getShootDayDocument,
} from "@/features/day-docs/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string; dayId: string }>;
};

export default async function CallSheetDayPage({ params }: Props) {
  const { locale, projectId, dayId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("callsheet:read") && !ctx.can("schedule:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к вызывным</p>;
  }

  const bundle = await getShootDayDocument(projectId, dayId);
  if (!bundle) notFound();

  const [astro, nextDay] = await Promise.all([
    fetchCityAstro(
      bundle.project.city,
      bundle.day.date,
      bundle.project.timezone,
    ),
    getNextShootDayBrief(projectId, bundle.day.dayNumber),
  ]);

  const nextDayAstro = nextDay
    ? await fetchCityAstro(
        bundle.project.city,
        nextDay.date,
        bundle.project.timezone,
      )
    : null;

  const canEdit =
    ctx.can("callsheet:write") || ctx.can("schedule:write");

  return (
    <CallSheetView
      locale={locale}
      projectId={projectId}
      bundle={bundle}
      astro={astro}
      nextDay={nextDay}
      nextDayAstro={nextDayAstro}
      canEdit={canEdit}
    />
  );
}
