import { notFound } from "next/navigation";
import { LocationDetailView } from "@/features/locations/components/location-detail-view";
import {
  getLocationDetail,
  listProjectAddresses,
} from "@/features/locations/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string; locationId: string }>;
};

export default async function LocationDetailPage({ params }: Props) {
  const { locale, projectId, locationId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [location, addresses] = await Promise.all([
    getLocationDetail(projectId, locationId),
    listProjectAddresses(projectId),
  ]);

  if (!location) notFound();

  return (
    <LocationDetailView
      locale={locale}
      projectId={projectId}
      location={location}
      addresses={addresses}
      canWrite={ctx.can("script:write")}
    />
  );
}
