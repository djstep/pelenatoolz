import { prisma } from "@/shared/db/prisma";
import { serializeForClient } from "@/shared/db/serialize-decimal";
import { formatFactDuration } from "@/features/reports/types";
import type { ProductionReportBundle } from "@/features/reports/types";
import { syncProductionWorkRows } from "@/features/reports/lib/sync-work-rows";

export type { ProductionReportBundle };
export { formatFactDuration, factSecondsLabel } from "@/features/reports/types";

function formatSceneLabel(scene: {
  episodeNumber: number;
  number: string;
  postfix: string;
  title: string | null;
}) {
  const ep = scene.episodeNumber > 0 ? `${scene.episodeNumber}-` : "";
  const num = `${ep}${scene.number}${scene.postfix || ""}`;
  return scene.title ? `${num} · ${scene.title}` : num;
}

export async function listProductionReports(projectId: string) {
  const days = await prisma.shootDay.findMany({
    where: { projectId },
    include: {
      _count: { select: { scenes: true } },
      productionReport: {
        select: {
          factShiftStart: true,
          factShiftEnd: true,
          _count: { select: { sceneFacts: true } },
        },
      },
    },
    orderBy: { dayNumber: "asc" },
  });

  return days.map((day) => ({
    id: day.id,
    dayNumber: day.dayNumber,
    date: day.date,
    dayType: day.dayType,
    status: day.status,
    callTime: day.callTime,
    wrapTime: day.wrapTime,
    isNightShift: day.isNightShift,
    sceneCount: day._count.scenes,
    factCount: day.productionReport?._count.sceneFacts ?? 0,
    factDuration: formatFactDuration(
      day.productionReport?.factShiftStart,
      day.productionReport?.factShiftEnd,
    ),
    factShiftStart: day.productionReport?.factShiftStart ?? null,
    factShiftEnd: day.productionReport?.factShiftEnd ?? null,
  }));
}

/** Гарантирует отчёт и подтягивает факты для сцен, ещё стоящих в дне. */
export async function ensureProductionReport(projectId: string, shootDayId: string) {
  const day = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    include: {
      scenes: {
        include: {
          scene: {
            select: {
              id: true,
              episodeNumber: true,
              number: true,
              postfix: true,
              title: true,
              planSeconds: true,
              factSeconds: true,
              status: true,
              pageCount: true,
            },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
      project: {
        select: {
          id: true,
          name: true,
          fullName: true,
          city: true,
          cameraCount: true,
        },
      },
    },
  });
  if (!day) return null;

  let report = await prisma.productionReport.findUnique({
    where: { shootDayId },
  });
  if (!report) {
    report = await prisma.productionReport.create({
      data: {
        shootDayId,
        factShiftStart: day.shiftStartTime ?? day.callTime,
        factShiftEnd: day.wrapTime,
      },
    });
  }

  const existingFacts = await prisma.productionReportSceneFact.findMany({
    where: { reportId: report.id },
    select: { sceneId: true },
  });
  const existingIds = new Set(existingFacts.map((f) => f.sceneId));

  const toCreate = day.scenes.filter((row) => !existingIds.has(row.sceneId));
  if (toCreate.length > 0) {
    await prisma.productionReportSceneFact.createMany({
      data: toCreate.map((row, index) => ({
        reportId: report!.id,
        sceneId: row.sceneId,
        sortOrder: row.sortOrder || index + 1,
        sceneLabel: formatSceneLabel(row.scene),
        factSeconds: row.scene.factSeconds,
        status:
          row.scene.status === "SHOT"
            ? "SHOT"
            : row.scene.status === "RESHOOT_REQUIRED"
              ? "RESHOOT_REQUIRED"
              : row.scene.status === "OFF_PLAN"
                ? "DELETED"
                : "NOT_SHOT",
        returnedToPool: false,
      })),
    });
  }

  // Refresh sortOrder for scenes still on day
  for (const row of day.scenes) {
    await prisma.productionReportSceneFact.updateMany({
      where: { reportId: report.id, sceneId: row.sceneId, returnedToPool: false },
      data: {
        sortOrder: row.sortOrder,
        sceneLabel: formatSceneLabel(row.scene),
      },
    });
  }

  await syncProductionWorkRows(projectId, shootDayId, report.id);

  const full = await prisma.productionReport.findUnique({
    where: { id: report.id },
    include: {
      sceneFacts: {
        include: {
          scene: {
            select: {
              id: true,
              episodeNumber: true,
              number: true,
              postfix: true,
              title: true,
              planSeconds: true,
              factSeconds: true,
              pageCount: true,
              status: true,
              summary: true,
            },
          },
          montageRows: { orderBy: { sortOrder: "asc" } },
        },
        orderBy: [{ returnedToPool: "asc" }, { sortOrder: "asc" }],
      },
      workRows: {
        include: { extras: { orderBy: { createdAt: "asc" } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return serializeForClient({
    day: {
      id: day.id,
      dayNumber: day.dayNumber,
      date: day.date,
      dayType: day.dayType,
      status: day.status,
      isNightShift: day.isNightShift,
      callTime: day.callTime,
      wrapTime: day.wrapTime,
      shiftStartTime: day.shiftStartTime,
    },
    project: day.project,
    cameraCount: Math.max(1, day.project.cameraCount ?? 1),
    report: full!,
    factDuration: formatFactDuration(full?.factShiftStart, full?.factShiftEnd),
  }) as unknown as ProductionReportBundle;
}
