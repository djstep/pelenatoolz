import { prisma } from "@/shared/db/prisma";

const sceneBriefSelect = {
  id: true,
  episodeNumber: true,
  number: true,
  postfix: true,
  status: true,
  planSeconds: true,
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

export async function listLocationsWithStats(projectId: string) {
  return prisma.location.findMany({
    where: { projectId },
    include: {
      scenes: {
        include: {
          scene: { select: sceneBriefSelect },
        },
      },
      photos: { orderBy: { sortOrder: "asc" } },
      _count: { select: { scenes: true, photos: true } },
    },
    orderBy: [{ name: "asc" }, { sublocation: "asc" }],
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

export async function getLocationDetail(projectId: string, locationId: string) {
  return prisma.location.findFirst({
    where: { id: locationId, projectId },
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
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
}

export type LocationWithStats = Awaited<
  ReturnType<typeof listLocationsWithStats>
>[number];

export type LocationDetail = NonNullable<
  Awaited<ReturnType<typeof getLocationDetail>>
>;
