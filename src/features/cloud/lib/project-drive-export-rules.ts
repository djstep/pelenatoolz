import type { DriveExportDestination, DrivePutOutcome } from "@/features/cloud/lib/drive-export-rules";

/**
 * Выгрузка вызывного на диск проекта (шаг 6) — чистые правила: кому какие назначения видны и
 * доступны, когда диск проекта недоступен, тексты окна. Без базы и сети; годится и для браузера.
 * Решение 11 и таблица п. 5 — `docs/tasks/WAVE_3_DRIVE_NOTES.md`:
 *   - «Мой диск» — «КПП и вызывные: просмотр»;
 *   - «Диск проекта — Общая» — «КПП и вызывные: правка»;
 *   - «Диск проекта — папка цеха» — главы ЭТОГО цеха (с просмотром вызывных) и продюсеры (все цеха).
 */

/** Кто выгружает — из проверенного контекста проекта (`requireProjectContext`). */
export type DriveExportActor = {
  /** «КПП и вызывные: просмотр» (`canReadCallSheet`). */
  canReadCallSheets: boolean;
  /** «КПП и вызывные: правка» (`canEditCallSheets`). */
  canEditCallSheets: boolean;
  isProducer: boolean;
  /** Цеха, где участник — глава (только текущее активное участие). */
  headDepartmentIds: readonly string[];
};

export type DriveDestinationAccess = {
  personal: boolean;
  common: boolean;
  /** "all" — продюсер (все цеха проекта); иначе — цеха, где человек глава. */
  departments: "all" | readonly string[];
};

/** Какие назначения доступны. Без просмотра вызывных — никаких (лист ему не виден вовсе). */
export function driveDestinationAccess(actor: DriveExportActor): DriveDestinationAccess {
  if (!actor.canReadCallSheets) return { personal: false, common: false, departments: [] };
  return {
    personal: true,
    common: actor.canEditCallSheets,
    departments: actor.isProducer ? "all" : [...new Set(actor.headDepartmentIds)],
  };
}

/** Можно ли выгрузить в это назначение. Принадлежность цеха проекту проверяет вызывающий. */
export function canExportToDestination(actor: DriveExportActor, destination: DriveExportDestination): boolean {
  const access = driveDestinationAccess(actor);
  switch (destination.kind) {
    case "personal":
      return access.personal;
    case "common":
      return access.common;
    case "department":
      return access.departments === "all" || access.departments.includes(destination.departmentId);
  }
}

/** Цеха для выбора в окне: продюсеру — все цеха проекта, главе — только свои. */
export function departmentsForExport<T extends { id: string }>(
  access: DriveDestinationAccess,
  projectDepartments: readonly T[],
): T[] {
  if (access.departments === "all") return [...projectDepartments];
  const own = new Set(access.departments);
  return projectDepartments.filter((d) => own.has(d.id));
}

/** Есть ли у человека хоть одно назначение на диске проекта (иначе раздел в окне не показывается). */
export function hasProjectDriveDestinations(access: DriveDestinationAccess, departmentsCount: number) {
  return access.common || departmentsCount > 0;
}

// ---------- диск проекта недоступен ----------

export type ProjectDriveUnavailable = "not_connected" | "reconnect";

/**
 * Диск проекта годится для выгрузки: подключён (ACTIVE, токен есть), хранитель — активный
 * продюсер, без пометки «нужно переподключить».
 */
export function projectDriveUnavailable(
  drive: {
    status: "ACTIVE" | "DETACHED";
    hasToken: boolean;
    needsReconnect: boolean;
    keeperActiveProducer: boolean;
  } | null,
): ProjectDriveUnavailable | null {
  if (!drive || drive.status !== "ACTIVE" || !drive.hasToken || !drive.keeperActiveProducer) {
    return "not_connected";
  }
  return drive.needsReconnect ? "reconnect" : null;
}

/** Отказ «диск проекта недоступен»: продюсерам (видят настройки диска) — куда идти, остальным — к кому. */
export function projectDriveUnavailableText(kind: ProjectDriveUnavailable, canOpenSettings: boolean): string {
  if (kind === "reconnect") {
    return canOpenSettings
      ? "Доступ к диску проекта отозван — переподключите его в настройках проекта"
      : "Доступ к диску проекта отозван — обратитесь к продюсеру";
  }
  return canOpenSettings
    ? "Диск проекта не подключён — подключите его в настройках проекта"
    : "Диск проекта не подключён — обратитесь к продюсеру";
}

// ---------- тексты ----------

/** Куда легло: «Общая» / папка цеха «Звук» — в сообщение и журнал. */
export function projectDrivePlaceLabel(kind: "common" | "department", departmentName: string | null) {
  return kind === "common" ? "«Общая»" : `папка цеха «${departmentName ?? "—"}»`;
}

/** Строка у назначения диска проекта: кто увидит файл (как выдаются доступы, шаг 5). */
export function projectDriveAudienceText(kind: "common" | "department", departmentName: string | null) {
  return kind === "common"
    ? "Все участники с доступом к вызывным"
    : `Главы цеха «${departmentName ?? "—"}» и продюсеры`;
}

/** Сообщение после выгрузки на диск проекта. `recreated` — файл или папку удалили на диске руками. */
export function projectDriveExportDoneText(outcome: DrivePutOutcome, placeLabel: string): string {
  if (outcome === "replaced") return `Файл на диске проекта (${placeLabel}) обновлён — ссылка прежняя`;
  if (outcome === "recreated") {
    return `Прежний файл или папку на диске проекта удалили — создан новый файл (${placeLabel}), ссылка новая`;
  }
  return `Вызывной выгружен на диск проекта — ${placeLabel}`;
}
