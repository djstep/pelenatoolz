import { requireProjectContext } from "@/features/projects/lib/project-context";
import { LocationsWorkspace } from "@/features/locations/components/locations-workspace";
import { formatLocationTitle } from "@/features/locations/lib/format-location";
import {
  listLocationsWithStats,
  listProjectAddresses,
} from "@/features/locations/queries";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function LocationsPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к локациям</p>;
  }

  const [locations, addresses] = await Promise.all([
    listLocationsWithStats(projectId),
    listProjectAddresses(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Локации</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Справочник площадок съёмки: название, подлокация, адрес, статистика по сценам.
        </p>
      </div>
      <Card>
        <LocationsWorkspace
          locale={locale}
          projectId={projectId}
          projectType={ctx.project.type}
          locations={locations}
          addresses={addresses}
          canWrite={ctx.can("script:write")}
        />
      </Card>
    </div>
  );
}
