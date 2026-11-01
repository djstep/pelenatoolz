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
  callSheetFileBaseName,
  checkCallSheetRead,
  dayLocationsOf,
  printSourceFromPageData,
} from "@/features/call-sheets/print/print-source";
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

/**
 * Модель листа для печати и Excel: вход и право проверяются здесь (чужой проект — 404 от
 * `requireProjectContext`), день — этого проекта и рабочий. Ничего не пишет.
 */
export async function loadCallSheetPrintModel(
  projectId: string,
  dayId: unknown,
): Promise<
  | { model: CallSheetPrintModel; fileBaseName: string }
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

  const [bundle, sheet, elements] = await Promise.all([
    getShootDayDocument(projectId, gate.dayId),
    getCallSheetForDay(projectId, gate.dayId),
    getCallSheetElementsEditor(projectId, gate.dayId),
  ]);
  if (!bundle) return { error: "Съёмочный день не найден", status: 404 };

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

  const model = buildCallSheetPrintModel(
    printSourceFromPageData(bundle, sheet, elements, astro, workingDay),
  );
  return { model, fileBaseName: callSheetFileBaseName(model) };
}
