import type { BudgetStatus } from "@prisma/client";
import {
  BUDGET_FOLDER_KEYS,
  budgetDepartmentFolderKey,
} from "@/features/cloud/lib/drive-access-rules";
import { DRIVE_EXPORT_BAD_INPUT, formatDriveDate, type DrivePutOutcome } from "@/features/cloud/lib/drive-export-rules";

/**
 * Выгрузка смет на диск проекта — чистые правила: куда, кто может, какая версия, имя файла,
 * разбор того, что пришло из браузера, тексты окна. Без базы и сети; годится и для браузера.
 * Решения владельца — `docs/tasks/BUDGET_DRIVE_NOTES.md`:
 *   - только диск проекта (личного диска для смет нет — решение 9);
 *   - смету цеха выгружают продюсеры и главы этого цеха, сводную — только продюсеры (решение 8,
 *     без финансового условия); выгружает только тот, кто сам получает доступ к папке;
 *   - версия: утверждена — последняя утверждённая, иначе текущий основной лист (решение 3).
 */

/** Куда выгрузить: папка цеха смет или «Сводная». */
export type BudgetDriveTarget = { kind: "department"; departmentId: string } | { kind: "summary" };

/** Папка, куда ложится файл (`DriveFolder.key`). */
export function budgetDriveFolderKey(target: BudgetDriveTarget): string {
  return target.kind === "summary" ? BUDGET_FOLDER_KEYS.summary : budgetDepartmentFolderKey(target.departmentId);
}

/** Id документа в `DriveExport` (`docType = BUDGET`): смета у цеха одна; сводная — одна на проект. */
export const BUDGET_SUMMARY_DOC_ID = "summary";

export function budgetDriveDocId(target: BudgetDriveTarget): string {
  return target.kind === "summary" ? BUDGET_SUMMARY_DOC_ID : target.departmentId;
}

// ---------- кто может ----------

/** Кто выгружает — из проверенного контекста проекта (`requireProjectContext`). */
export type BudgetDriveActor = {
  isProducer: boolean;
  /** Цеха, где участник — глава (только текущее активное участие). */
  headDepartmentIds: readonly string[];
};

export type BudgetDriveAccess = {
  summary: boolean;
  /** "all" — продюсер (все цеха проекта); иначе — цеха, где человек глава. */
  departments: "all" | readonly string[];
};

/**
 * Какие назначения доступны. «Финансы: просмотр» и «Сметы — просмотр всех» не участвуют: доступ
 * к папкам смет получают только главы цеха и продюсеры — выгружают тоже только они.
 */
export function budgetDriveAccess(actor: BudgetDriveActor): BudgetDriveAccess {
  return {
    summary: actor.isProducer,
    departments: actor.isProducer ? "all" : [...new Set(actor.headDepartmentIds)],
  };
}

/** Можно ли выгрузить сюда. Принадлежность цеха проекту проверяет вызывающий (`assertInProject`). */
export function canExportBudgetToDrive(actor: BudgetDriveActor, target: BudgetDriveTarget): boolean {
  const access = budgetDriveAccess(actor);
  if (target.kind === "summary") return access.summary;
  return access.departments === "all" || access.departments.includes(target.departmentId);
}

// ---------- версия ----------

export type BudgetStatusValue = BudgetStatus;

/** Статус в имени файла и в `DriveExport.statusLabel`: строчными. */
export const BUDGET_DRIVE_STATUS_LABELS: Record<BudgetStatusValue, string> = {
  DRAFT: "черновик",
  SUBMITTED: "на утверждении",
  RETURNED: "возвращена",
  APPROVED: "утверждена",
};

/** Что выгружается: утверждённая версия (снимок) или текущий основной лист. */
export type BudgetDriveSource = { kind: "version"; number: number } | { kind: "current"; status: BudgetStatusValue };

/** Версия в окне по умолчанию: утверждена — последняя утверждённая; иначе — текущая (`null`). */
export function defaultBudgetDriveVersion(budget: {
  status: BudgetStatusValue;
  latestVersion: number | null;
}): number | null {
  return budget.status === "APPROVED" && budget.latestVersion ? budget.latestVersion : null;
}

/**
 * Что выгрузить на сервере. Выбрана версия — она (существование версии у этого цеха проверяет
 * вызывающий); не выбрана — как по умолчанию в окне.
 */
export function resolveBudgetDriveSource(
  budget: { status: BudgetStatusValue; latestVersion: number | null },
  requestedVersion: number | undefined,
): BudgetDriveSource {
  const number = requestedVersion ?? defaultBudgetDriveVersion(budget);
  return number ? { kind: "version", number } : { kind: "current", status: budget.status };
}

/** `DriveExport.statusLabel` и строка «уже на диске». */
export function budgetDriveStatusLabel(source: BudgetDriveSource): string {
  return source.kind === "version"
    ? BUDGET_DRIVE_STATUS_LABELS.APPROVED
    : BUDGET_DRIVE_STATUS_LABELS[source.status];
}

/** Решение 12 (обновление только вручную): на диске версия старше последней утверждённой. */
export function budgetDriveOutdatedText(
  onDrive: { version: number | null } | null,
  latestVersion: number | null,
): string | null {
  if (!onDrive?.version || !latestVersion || onDrive.version >= latestVersion) return null;
  return `На диске — версия ${onDrive.version}, утверждена версия ${latestVersion}`;
}

// ---------- имена файлов ----------

function current(status: BudgetStatusValue): string {
  if (status === "DRAFT") return "черновик";
  if (status === "APPROVED") return "текущая (утверждена)";
  return `черновик (${BUDGET_DRIVE_STATUS_LABELS[status]})`;
}

/**
 * Имя файла сметы цеха: «Смета · Звук · версия 3 (утверждена)»; текущий лист —
 * «Смета · Звук · черновик (на утверждении) · 03.11.2026» (дата выгрузки по поясу проекта).
 * Без расширения: это Google Таблица.
 */
export function budgetDriveFileName(
  departmentName: string,
  source: BudgetDriveSource,
  exportedAt: Date,
  timezone: string | null,
): string {
  const head = `Смета · ${departmentName.trim() || "Цех"}`;
  if (source.kind === "version") return `${head} · версия ${source.number} (утверждена)`;
  return `${head} · ${current(source.status)} · ${formatDriveDate(exportedAt, timezone)}`;
}

/** «утверждённые версии» / «с черновиками» — режим сводной в имени, `statusLabel`, журнале. */
export function summaryDriveModeLabel(drafts: boolean): string {
  return drafts ? "с черновиками" : "утверждённые версии";
}

/** Имя файла сводной: «Сводная смета · утверждённые версии · 03.11.2026» — факт на дату выгрузки. */
export function summaryDriveFileName(drafts: boolean, exportedAt: Date, timezone: string | null): string {
  return `Сводная смета · ${summaryDriveModeLabel(drafts)} · ${formatDriveDate(exportedAt, timezone)}`;
}

// ---------- что пришло из браузера ----------

export type BudgetDriveRequest =
  | { target: { kind: "department"; departmentId: string }; version: number | undefined }
  | { target: { kind: "summary" }; drafts: boolean };

/**
 * Из браузера — только назначение (`department` / `summary`), id цеха, номер утверждённой версии
 * (пусто — по умолчанию), у сводной — «с черновиками». Почты, id папок и файлов, `projectId`,
 * суммы не принимаются; права, цех и версию проверяет сервер.
 */
export function parseBudgetDriveRequest(raw: unknown): BudgetDriveRequest | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: DRIVE_EXPORT_BAD_INPUT };
  const { target, departmentId, version, drafts } = raw as {
    target?: unknown;
    departmentId?: unknown;
    version?: unknown;
    drafts?: unknown;
  };
  if (target === "summary") {
    if (drafts !== undefined && typeof drafts !== "boolean") return { error: DRIVE_EXPORT_BAD_INPUT };
    return { target: { kind: "summary" }, drafts: drafts === true };
  }
  if (target !== "department") return { error: DRIVE_EXPORT_BAD_INPUT };
  if (typeof departmentId !== "string" || departmentId.trim() === "" || departmentId.length > 100) {
    return { error: DRIVE_EXPORT_BAD_INPUT };
  }
  if (version === undefined || version === null) {
    return { target: { kind: "department", departmentId }, version: undefined };
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 999_999) {
    return { error: DRIVE_EXPORT_BAD_INPUT };
  }
  return { target: { kind: "department", departmentId }, version };
}

// ---------- тексты ----------

/** Куда легло — в сообщение и журнал. */
export function budgetDrivePlaceLabel(target: BudgetDriveTarget, departmentName: string | null): string {
  return target.kind === "summary" ? "«Сметы / Сводная»" : `папка цеха «${departmentName ?? "—"}» в «Сметах»`;
}

/** Строка в окне: кто увидит файл (как выдаются доступы к папкам смет). */
export function budgetDriveAudienceText(target: BudgetDriveTarget, departmentName: string | null): string {
  return target.kind === "summary"
    ? "Только продюсеры"
    : `Главы цеха «${departmentName ?? "—"}» и продюсеры`;
}

/** Сообщение после выгрузки. `recreated` — файл или папку удалили на диске руками. */
export function budgetDriveExportDoneText(
  target: BudgetDriveTarget,
  outcome: DrivePutOutcome,
  placeLabel: string,
): string {
  if (outcome === "replaced") return `Файл на диске проекта (${placeLabel}) обновлён — ссылка прежняя`;
  if (outcome === "recreated") {
    return `Прежний файл или папку на диске проекта удалили — создан новый файл (${placeLabel}), ссылка новая`;
  }
  return target.kind === "summary"
    ? `Сводная смета выгружена на диск проекта — ${placeLabel}`
    : `Смета выгружена на диск проекта — ${placeLabel}`;
}

/** Строка в окне выгрузки: диск — для просмотра и комментариев, решение — в системе. */
export const BUDGET_DRIVE_APPROVAL_NOTE =
  "Утверждение — только в системе: комментарии в Google Таблице в историю сметы не попадают.";

/**
 * Подсказка до первой выгрузки смет в проект: файлы с деньгами остаются в аккаунте хранителя
 * диска проекта — лучше, чтобы это был служебный аккаунт компании.
 */
export function budgetDriveKeeperHint(accountEmail: string | null): string {
  const account = accountEmail ? `аккаунте «${accountEmail}»` : "аккаунте хранителя диска проекта";
  return (
    `Сметы лягут на диск проекта — в ${account}. Лучше, чтобы это был служебный аккаунт компании: ` +
    "файлы с деньгами остаются у того, кто подключил диск, и после его ухода из проекта."
  );
}
