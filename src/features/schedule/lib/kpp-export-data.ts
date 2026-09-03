import { serializeForClient } from "@/shared/db/serialize-decimal";
import { prisma } from "@/shared/db/prisma";

export type KppExportScene = {
  id: string;
  number: string;
  postfix: string;
  episodeNumber: number;
  title: string | null;
  summary: string | null;
  planSeconds: number | null;
  pageCount: number | null;
  intExt: string | null;
  dayNight: string | null;
  status: string;
  scriptDay: number | null;
  locations: { location: { id: string; name: string; sublocation: string | null } }[];
  characters: { character: { id: string; name: string } }[];
  resourceItems: {
    quantity: number;
    item: {
      id: string;
      name: string;
      category: { id: string; name: string };
    };
  }[];
};

export type KppExportSlot = {
  id: string;
  startTime: string;
  endTime: string | null;
  slotType: string;
  sceneId: string | null;
  notes: string | null;
  sortOrder: number;
};

export type KppExportDay = {
  id: string;
  dayNumber: number;
  date: Date;
  dayType: string;
  unit: string | null;
  isNightShift: boolean;
  callTime: string | null;
  wrapTime: string | null;
  comment: string | null;
  scenes: {
    id: string;
    sceneId: string;
    sortOrder: number;
    notes: string | null;
    scene: KppExportScene;
  }[];
  timeSlots: KppExportSlot[];
};

export type KppExportBundle = {
  projectId: string;
  projectName: string;
  cameraUnits: number;
  units: string[];
  resourceCategories: { id: string; name: string }[];
  days: KppExportDay[];
  hasTechnicalBreaks: boolean;
};

/** Данные для экспорта полного/краткого КПП. */
export async function getKppExportBundle(
  projectId: string,
): Promise<KppExportBundle | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, cameraUnits: true },
  });
  if (!project) return null;

  const [days, resourceCategories] = await Promise.all([
    prisma.shootDay.findMany({
      where: { projectId },
      include: {
        scenes: {
          include: {
            scene: {
              select: {
                id: true,
                number: true,
                postfix: true,
                episodeNumber: true,
                title: true,
                summary: true,
                planSeconds: true,
                pageCount: true,
                intExt: true,
                dayNight: true,
                status: true,
                scriptDay: true,
                locations: {
                  include: {
                    location: {
                      select: {
                        id: true,
                        name: true,
                        sublocation: true,
                      },
                    },
                  },
                },
                characters: {
                  include: {
                    character: { select: { id: true, name: true } },
                  },
                },
                resourceItems: {
                  include: {
                    item: {
                      include: {
                        category: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
        timeSlots: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: { dayNumber: "asc" },
    }),
    prisma.resourceCategory.findMany({
      where: { projectId, showInKpp: true },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  const unitSet = new Set<string>();
  let hasTechnicalBreaks = false;
  for (const day of days) {
    unitSet.add(day.unit?.trim() || "main");
    if (day.timeSlots.some((s) => s.slotType !== "SHOOTING")) {
      hasTechnicalBreaks = true;
    }
  }

  const units = [...unitSet].sort((a, b) => {
    if (a === "main") return -1;
    if (b === "main") return 1;
    return a.localeCompare(b, "ru");
  });

  return serializeForClient({
    projectId: project.id,
    projectName: project.name,
    cameraUnits: Math.max(1, project.cameraUnits ?? 1),
    units,
    resourceCategories,
    days,
    hasTechnicalBreaks,
  }) as KppExportBundle;
}
