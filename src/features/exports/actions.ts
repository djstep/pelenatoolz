"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { crewExportColumns } from "@/features/crew/lib/crew-export";
import { crewRights } from "@/features/crew/lib/crew-rules";
import {
  ATTENDANCE_SHEET_WRITE_PERMISSION,
  exportLayoutPermission,
  exportLayoutSavePermissions,
  isExportLayoutKey,
  keepProjectAttendanceSectionIds,
  normalizeAttendanceSheetSettings,
  normalizeExportLayout,
  parseExportSettings,
} from "@/features/exports/lib/column-utils";
import {
  parseAttendanceCategorySectionId,
  type AttendanceSheetSettings,
  type ExportColumn,
  type ExportLayout,
  type ExportLayoutKey,
} from "@/features/exports/types";
import { hasPermission } from "@/features/memberships/permissions";
import { requireProjectAccess } from "@/features/memberships/queries";
import { parsePermissionMatrix } from "@/features/roles/permissions-matrix";
import { prisma } from "@/shared/db/prisma";

export type ExportActionState = {
  error?: string;
  success?: string;
  layout?: ExportLayout | null;
  attendanceSheet?: AttendanceSheetSettings | null;
};

export async function getExportLayoutAction(
  projectId: string,
  key: string,
): Promise<ExportActionState> {
  if (!isExportLayoutKey(key)) {
    return { error: "Неизвестный тип экспорта" };
  }

  let membership: Awaited<ReturnType<typeof requireProjectAccess>>;
  try {
    const user = await requireUser();
    membership = await requireProjectAccess(
      projectId,
      user.id!,
      exportLayoutPermission(key, "read"),
    );
  } catch {
    return { error: "Недостаточно прав" };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { exportSettings: true },
  });
  if (!project) return { error: "Проект не найден" };

  const settings = parseExportSettings(project.exportSettings);
  const layout = settings[key] ?? null;
  if (key !== "crew" || !layout) return { layout };

  // Раскладка общая на проект: у каждого — только колонки, на которые есть право.
  const matrix = parsePermissionMatrix(membership.role.permissions);
  const rights = crewRights((permission) => hasPermission(matrix, permission));
  return { layout: { ...layout, columns: crewExportColumns(layout.columns, rights) } };
}

export async function saveExportLayoutAction(
  projectId: string,
  key: ExportLayoutKey | string,
  columns: ExportColumn[],
  extras?: {
    includeTechnicalBreaks?: boolean;
    showWeekday?: boolean;
  },
): Promise<ExportActionState> {
  if (!isExportLayoutKey(key)) {
    return { error: "Неизвестный тип экспорта" };
  }

  try {
    const user = await requireUser();
    for (const permission of exportLayoutSavePermissions(key)) {
      await requireProjectAccess(projectId, user.id!, permission);
    }
  } catch {
    return { error: "Недостаточно прав" };
  }

  const layout = normalizeExportLayout({
    columns,
    includeTechnicalBreaks: extras?.includeTechnicalBreaks,
    showWeekday: extras?.showWeekday,
  });
  if (!layout) {
    return { error: "Добавьте хотя бы один столбец" };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { exportSettings: true },
  });
  if (!project) return { error: "Проект не найден" };

  const settings = parseExportSettings(project.exportSettings);
  const next = { ...settings, [key]: layout };

  await prisma.project.update({
    where: { id: projectId },
    data: {
      exportSettings: next as Prisma.InputJsonValue,
    },
  });

  revalidatePath(`/ru/projects/${projectId}`);
  return { success: "Раскладка сохранена", layout };
}

export async function getAttendanceSheetSettingsAction(
  projectId: string,
): Promise<ExportActionState> {
  const { requireProjectContext } = await import(
    "@/features/projects/lib/project-context"
  );
  const ctx = await requireProjectContext(projectId);
  if (
    !ctx.can("callsheet:read") &&
    !ctx.can("schedule:read") &&
    !ctx.can("report:read") &&
    !ctx.can("project:read")
  ) {
    return { error: "Недостаточно прав" };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { exportSettings: true },
  });
  if (!project) return { error: "Проект не найден" };

  const settings = parseExportSettings(project.exportSettings);
  return {
    attendanceSheet: settings.attendanceSheet ?? { resourceIds: [] },
  };
}

export async function saveAttendanceSheetSettingsAction(
  projectId: string,
  resourceIds: string[],
): Promise<ExportActionState> {
  const { requireProjectContext } = await import(
    "@/features/projects/lib/project-context"
  );
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can(ATTENDANCE_SHEET_WRITE_PERMISSION)) {
    return { error: "Недостаточно прав" };
  }

  const requested = normalizeAttendanceSheetSettings({ resourceIds })?.resourceIds ?? [];
  const requestedCategoryIds = requested
    .map(parseAttendanceCategorySectionId)
    .filter((id): id is string => id !== null);
  const projectCategories =
    requestedCategoryIds.length > 0
      ? await prisma.resourceCategory.findMany({
          where: { projectId, id: { in: requestedCategoryIds } },
          select: { id: true },
        })
      : [];
  const attendanceSheet: AttendanceSheetSettings = {
    resourceIds: keepProjectAttendanceSectionIds(
      requested,
      new Set(projectCategories.map((c) => c.id)),
    ),
  };

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { exportSettings: true },
  });
  if (!project) return { error: "Проект не найден" };

  const settings = parseExportSettings(project.exportSettings);
  const next = { ...settings, attendanceSheet };

  await prisma.project.update({
    where: { id: projectId },
    data: {
      exportSettings: next as Prisma.InputJsonValue,
    },
  });

  revalidatePath(`/ru/projects/${projectId}`);
  return { success: "Настройки явочного листа сохранены", attendanceSheet };
}
