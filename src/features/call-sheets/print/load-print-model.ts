import "server-only";
import { getCallSheetElementsEditor } from "@/features/call-sheets/elements-queries";
import { pickAstroPoint } from "@/features/call-sheets/lib/astro-point";
import { getCallSheetForDay } from "@/features/call-sheets/queries";
import {
  buildCallSheetPrintModel,
  type CallSheetPrintModel,
  type CallSheetPrintSource,
} from "@/features/call-sheets/print/print-model";
import {
  callSheetDataHash,
  callSheetFileBaseName,
  checkCallSheetRead,
  choosePrintSource,
  dayLocationsOf,
  parseSnapshotModel,
  parseVersionParam,
  printSourceFromPageData,
} from "@/features/call-sheets/print/print-source";
import { formatApprovedAt, type CallSheetStamp } from "@/features/call-sheets/print/stamp";
import { fetchDayAstro } from "@/features/day-docs/lib/city-astro";
import { getShootDayDocument } from "@/features/day-docs/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { isWorkingShootDay } from "@/features/schedule/lib/shoot-day-type";
import { prisma } from "@/shared/db/prisma";

/** «День N из M»: место дня среди рабочих дней КПП своей группы (юнита). Только чтение. */
export async function getWorkingDayPosition(
  projectId: string,
  day: { dayNumber: number; unit: string | null },
): Promise<CallSheetPrintSource["workingDay"]> {
  const where = { projectId, dayType: "WORKING" as const, unit: day.unit };
  const [index, total] = await Promise.all([
    prisma.shootDay.count({ where: { ...where, dayNumber: { lte: day.dayNumber } } }),
    prisma.shootDay.count({ where }),
  ]);
  return index > 0 && total > 0 ? { index, total } : null;
}

/** Право «КПП и вызывные: просмотр». */
export function canReadCallSheet(ctx: { can: (permission: "callsheet:read" | "schedule:read") => boolean }) {
  return ctx.can("callsheet:read") || ctx.can("schedule:read");
}

export const VERSION_NOT_FOUND = "Утверждённая версия вызывного не найдена";

/**
 * Лист по живым данным дня (черновик, утверждение) и отпечаток данных дня. Право здесь
 * не проверяется — его проверяет вызывающий до вызова. Ничего не пишет.
 */
export async function buildLiveCallSheet(
  projectId: string,
  dayId: string,
): Promise<{ model: CallSheetPrintModel; dataHash: string } | null> {
  const [bundle, sheet, elements] = await Promise.all([
    getShootDayDocument(projectId, dayId),
    getCallSheetForDay(projectId, dayId),
    getCallSheetElementsEditor(projectId, dayId),
  ]);
  if (!bundle) return null;

  const [astro, workingDay] = await Promise.all([
    fetchDayAstro(
      {
        city: bundle.project.city,
        point: pickAstroPoint(sheet?.schemeLocation, dayLocationsOf(bundle)),
      },
      bundle.day.date,
      bundle.project.timezone,
    ),
    getWorkingDayPosition(projectId, bundle.day),
  ]);

  const source = printSourceFromPageData(bundle, sheet, elements, astro, workingDay);
  return { model: buildCallSheetPrintModel(source), dataHash: callSheetDataHash(source) };
}

/**
 * Модель листа для печати и Excel: вход и право проверяются здесь (чужой проект — 404 от
 * `requireProjectContext`), день — этого проекта и рабочий. Ничего не пишет.
 * Утверждённый вызывной — из снимка своей версии, `version` из адреса — снимок этой версии;
 * иначе — живые данные дня с меткой черновика / согласования.
 */
export async function loadCallSheetPrintModel(
  projectId: string,
  dayId: unknown,
  version?: unknown,
): Promise<
  | { model: CallSheetPrintModel; fileBaseName: string; stamp: CallSheetStamp }
  | { error: string; status: 403 | 404 }
> {
  const ctx = await requireProjectContext(projectId);
  const gate = await checkCallSheetRead(
    {
      canRead: canReadCallSheet(ctx),
      dayInProject: async (id) => {
        const day = await prisma.shootDay.findFirst({
          where: { id, projectId },
          select: { dayType: true },
        });
        return day ? { working: isWorkingShootDay(day.dayType) } : null;
      },
    },
    dayId,
  );
  if ("error" in gate) return gate;

  const requested = parseVersionParam(version);
  if (requested === null) return { error: VERSION_NOT_FOUND, status: 404 };

  const sheet = await prisma.callSheet.findFirst({
    where: { projectId, shootDayId: gate.dayId },
    select: { id: true, status: true, version: true, project: { select: { timezone: true } } },
  });

  const from = choosePrintSource(sheet, requested);
  if (from.kind === "snapshot") {
    const snapshotVersion = from.version;
    if (!sheet) return { error: VERSION_NOT_FOUND, status: 404 };
    const row = await prisma.callSheetApprovedVersion.findUnique({
      where: { callSheetId_version: { callSheetId: sheet.id, version: snapshotVersion } },
      select: { snapshot: true, approvedAt: true },
    });
    const model = row ? parseSnapshotModel(row.snapshot) : null;
    if (!row || !model) return { error: VERSION_NOT_FOUND, status: 404 };
    return {
      model,
      fileBaseName: `${callSheetFileBaseName(model)} версия ${snapshotVersion}`,
      stamp: {
        status: "APPROVED",
        version: snapshotVersion,
        approvedAtLabel: formatApprovedAt(row.approvedAt, sheet.project.timezone),
      },
    };
  }

  const live = await buildLiveCallSheet(projectId, gate.dayId);
  if (!live) return { error: "Съёмочный день не найден", status: 404 };
  return {
    model: live.model,
    fileBaseName: callSheetFileBaseName(live.model),
    stamp: {
      status: sheet?.status === "IN_REVIEW" ? "IN_REVIEW" : "DRAFT",
      version: sheet?.version ?? null,
    },
  };
}
