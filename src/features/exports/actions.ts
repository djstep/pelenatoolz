"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import {
  isExportLayoutKey,
  normalizeExportLayout,
  parseExportSettings,
} from "@/features/exports/lib/column-utils";
import type {
  ExportColumn,
  ExportLayout,
  ExportLayoutKey,
} from "@/features/exports/types";
import { requireProjectAccess } from "@/features/memberships/queries";
import { prisma } from "@/shared/db/prisma";

export type ExportActionState = {
  error?: string;
  success?: string;
  layout?: ExportLayout | null;
};

export async function getExportLayoutAction(
  projectId: string,
  key: string,
): Promise<ExportActionState> {
  try {
    const user = await requireUser();
    await requireProjectAccess(projectId, user.id!, "project:read");
  } catch {
    return { error: "Недостаточно прав" };
  }

  if (!isExportLayoutKey(key)) {
    return { error: "Неизвестный тип экспорта" };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { exportSettings: true },
  });
  if (!project) return { error: "Проект не найден" };

  const settings = parseExportSettings(project.exportSettings);
  return { layout: settings[key] ?? null };
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
  try {
    const user = await requireUser();
    await requireProjectAccess(projectId, user.id!, "project:write");
  } catch {
    return { error: "Недостаточно прав" };
  }

  if (!isExportLayoutKey(key)) {
    return { error: "Неизвестный тип экспорта" };
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
