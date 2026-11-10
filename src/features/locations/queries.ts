import { prisma } from "@/shared/db/prisma";
import { parseScoutSnapshot } from "@/features/preproduction/lib/snapshots";
import {
  LOCATION_FIELDS,
  LOCATION_PARENT_PLACE_SELECT,
  SCOUT_SNAPSHOT_FIELDS,
} from "@/features/locations/lib/location-fields";
import { compareLocations } from "@/features/locations/lib/format-location";
import { serializeForClient } from "@/shared/db/serialize-decimal";
import { pickFinanceFields } from "@/shared/lib/finance-fields";

const sceneBriefSelect = {
  id: true,
  episodeNumber: true,
  number: true,
  postfix: true,
  status: true,
  planSeconds: true,
  cutAt: true,
  scriptDay: true,
  characters: {
    include: { character: { select: { id: true, name: true } } },
  },
  shootDayScenes: {
    include: {
      shootDay: {
        select: { id: true, date: true, dayNumber: true, unit: true },
      },
    },
  },
} as const;

/** `canFinanceRead` — фин. просмотр объектов (`ctx.canFinanceRead("locations")`). */
export async function listLocationsWithStats(projectId: string, canFinanceRead: boolean) {
  const locations = await prisma.location.findMany({
    where: { projectId },
    include: {
      parent: LOCATION_PARENT_PLACE_SELECT,
      scenes: {
        include: {
          scene: { select: sceneBriefSelect },
        },
      },
      photos: { orderBy: { sortOrder: "asc" } },
      _count: { select: { scenes: true, photos: true } },
    },
  });
  return locations
    .sort(compareLocations)
    .map((location) => locationForClient(location, canFinanceRead));
}

function locationForClient<T extends { scoutSnapshot: unknown }>(
  location: T,
  canFinanceRead: boolean,
) {
  const snapshot = parseScoutSnapshot(location.scoutSnapshot);
  return serializeForClient({
    ...pickFinanceFields(location, LOCATION_FIELDS, canFinanceRead),
    scoutSnapshot: snapshot
      ? pickFinanceFields(snapshot, SCOUT_SNAPSHOT_FIELDS, canFinanceRead)
      : null,
  });
}

export async function listProjectAddresses(projectId: string) {
  const rows = await prisma.location.findMany({
    where: { projectId, address: { not: null } },
    select: { address: true },
    distinct: ["address"],
    orderBy: { address: "asc" },
  });
  return rows
    .map((r) => r.address)
    .filter((a): a is string => Boolean(a?.trim()));
}

/** `canFinanceRead` — фин. просмотр объектов (`ctx.canFinanceRead("locations")`). */
export async function getLocationDetail(
  projectId: string,
  locationId: string,
  canFinanceRead: boolean,
) {
  const location = await prisma.location.findFirst({
    where: { id: locationId, projectId },
    include: {
      parent: LOCATION_PARENT_PLACE_SELECT,
      photos: { orderBy: { sortOrder: "asc" } },
      overtimeRates: { orderBy: { hourNumber: "asc" } },
      points: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, number: true, name: true, description: true },
      },
      scoutCandidateLinks: {
        include: {
          scoutCandidate: {
            select: { id: true, title: true, status: true, updatedAt: true },
          },
        },
      },
      scenes: {
        include: {
          scene: {
            select: {
              ...sceneBriefSelect,
              summary: true,
              factSeconds: true,
            },
          },
        },
      },
    },
  });

  if (!location) return null;

  return locationForClient(location, canFinanceRead);
}

export type LocationWithStats = Awaited<
  ReturnType<typeof listLocationsWithStats>
>[number];

export type LocationDetail = NonNullable<
  Awaited<ReturnType<typeof getLocationDetail>>
>;

export type LocationEditSource = Pick<
  LocationDetail,
  | "id"
  | "name"
  | "parent"
  | "locationKind"
  | "hasDecoration"
  | "address"
  | "tags"
  | "notes"
>;
