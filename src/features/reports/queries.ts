import { cache } from "react";
import { prisma } from "@/shared/db/prisma";
import { serializeForClient } from "@/shared/db/serialize-decimal";
import { formatFactDuration } from "@/features/reports/types";
import type { ProductionReportBundle } from "@/features/reports/types";
import {
  applyWorkRowSync,
  planWorkRowSync,
  type WorkRowSyncPlan,
} from "@/features/reports/lib/sync-work-rows";
import {
  syncReportAccruals,
  type AccrualSyncCounts,
} from "@/features/reports/lib/sync-accruals";
import type { AuditContext } from "@/shared/audit/with-audit";

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


const daySelect = {
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
    orderBy: { sortOrder: "asc" as const },
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
};

/** Один раз за запрос страницы: отчёт и сравнение читают один и тот же день. */
const loadDay = cache(async (projectId: string, shootDayId: string) => {
  return prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    include: daySelect,
  });
});

type DayWithScenes = NonNullable<Awaited<ReturnType<typeof loadDay>>>;

/** Съёмочный день отчёта (есть ли он вообще) — для страницы, когда отчёта ещё нет. */
export async function getShootDayBrief(projectId: string, shootDayId: string) {
  const day = await loadDay(projectId, shootDayId);
  return day ? { id: day.id, dayNumber: day.dayNumber, date: day.date } : null;
}

/**
 * Отчёт дня — только чтение. null — отчёта ещё нет (создаётся кнопкой «Создать из КПП»)
 * или нет такого дня.
 */
export async function getProductionReport(projectId: string, shootDayId: string) {
  const day = await loadDay(projectId, shootDayId);
  if (!day) return null;

  const full = await prisma.productionReport.findUnique({
    where: { shootDayId },
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
  if (!full) return null;

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
    report: full,
    factDuration: formatFactDuration(full.factShiftStart, full.factShiftEnd),
  }) as unknown as ProductionReportBundle;
}

/** Сцены дня из КПП против фактов отчёта: какие добавятся, у каких сменятся порядок или подпись. */
async function planSceneFacts(day: DayWithScenes, reportId: string) {
  const facts = await prisma.productionReportSceneFact.findMany({
    where: { reportId },
    select: { sceneId: true, sortOrder: true, sceneLabel: true, returnedToPool: true },
  });
  const bySceneId = new Map(facts.map((f) => [f.sceneId, f]));
  const toCreate = day.scenes.filter((row) => !bySceneId.has(row.sceneId));
  const toUpdate = day.scenes.filter((row) => {
    const fact = bySceneId.get(row.sceneId);
    return (
      fact &&
      !fact.returnedToPool &&
      (fact.sortOrder !== row.sortOrder || fact.sceneLabel !== formatSceneLabel(row.scene))
    );
  });
  return { toCreate, toUpdate };
}

export type ReportStaleness = {
  scenesAdded: string[];
  scenesChanged: number;
  rows: WorkRowSyncPlan;
  accruals: AccrualSyncCounts;
  stale: boolean;
};

/**
 * Что изменит «Обновить из КПП»: сцены, строки работы, ставки (только с галочкой),
 * начисления. Ничего не пишет — для плашки «Отчёт устарел, обновить?».
 */
export async function getReportStaleness(
  projectId: string,
  shootDayId: string,
): Promise<ReportStaleness | null> {
  const [day, report] = await Promise.all([
    loadDay(projectId, shootDayId),
    prisma.productionReport.findUnique({ where: { shootDayId }, select: { id: true } }),
  ]);
  if (!day || !report) return null;

  // Части сравнения независимы — читаются параллельно (на медленной базе это в разы быстрее).
  const [scenes, rows, accruals] = await Promise.all([
    planSceneFacts(day, report.id),
    planWorkRowSync(projectId, shootDayId, report.id),
    syncReportAccruals(null, projectId, shootDayId, undefined, { dryRun: true }),
  ]);
  if (!rows) return null;

  const stale =
    scenes.toCreate.length + scenes.toUpdate.length > 0 ||
    rows.added.length + rows.removed.length + rows.rateChanges.length + rows.otherChanged.length >
      0 ||
    accruals.created + accruals.updated + accruals.zeroed > 0;
  return {
    scenesAdded: scenes.toCreate.map((row) => formatSceneLabel(row.scene)),
    scenesChanged: scenes.toUpdate.length,
    rows,
    accruals,
    stale,
  };
}

/**
 * «Создать из КПП» / «Обновить из КПП»: создаёт отчёт (только при `create`), добавляет сцены
 * дня, обновляет порядок и подписи, пересобирает строки работы и начисления. Ставки
 * существующих строк — только при `updateRates`. Вызывать только из серверного действия
 * с проверкой права правки отчёта.
 */
export async function refreshProductionReport(
  audit: AuditContext,
  projectId: string,
  shootDayId: string,
  options: { create: boolean; updateRates: boolean },
) {
  const day = await loadDay(projectId, shootDayId);
  if (!day) return { error: "Съёмочный день не найден" } as const;

  let report = await prisma.productionReport.findUnique({ where: { shootDayId } });
  const createdNow = !report;
  if (!report) {
    if (!options.create) return { error: "Отчёт ещё не создан" } as const;
    report = await prisma.productionReport.create({
      data: {
        shootDayId,
        factShiftStart: day.shiftStartTime ?? day.callTime,
        factShiftEnd: day.wrapTime,
      },
    });
  }
  const reportId = report.id;

  const scenes = await planSceneFacts(day, reportId);
  if (scenes.toCreate.length > 0) {
    await prisma.productionReportSceneFact.createMany({
      data: scenes.toCreate.map((row, index) => ({
        reportId,
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
  for (const row of scenes.toUpdate) {
    await prisma.productionReportSceneFact.updateMany({
      where: { reportId, sceneId: row.sceneId, returnedToPool: false },
      data: {
        sortOrder: row.sortOrder,
        sceneLabel: formatSceneLabel(row.scene),
      },
    });
  }

  const rows = await applyWorkRowSync(audit, projectId, shootDayId, reportId, {
    updateRates: options.updateRates,
  });
  return { created: createdNow, scenesAdded: scenes.toCreate.length, rows } as const;
}
