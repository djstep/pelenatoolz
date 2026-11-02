/**
 * Правила диска проекта (решения по вопросам 1–3 и дополнения 1–2, `WAVE_3_DRIVE_NOTES.md`).
 * Чистые функции без базы и серверных модулей: их же берёт интерфейс (окна участников).
 */

/** Кто действует: его участие в проекте и роль на момент проверки. */
export type ProjectDriveActor = {
  userId: string;
  /** Активное участие в проекте; null — не участник (или удалён). */
  membershipId: string | null;
  isProducer: boolean;
  ownerUserId: string | null;
};

/** Диск проекта, как он записан в базе (или null — ни разу не подключали). */
export type ProjectDriveState = {
  status: "ACTIVE" | "DETACHED";
  keeperMembershipId: string | null;
};

/** Почему у диска проекта статус DETACHED: отключили руками или хранитель перестал быть продюсером. */
export const PROJECT_DRIVE_DETACH_REASON = {
  disconnected: "disconnected",
  keeperLeft: "keeper_left",
} as const;

export type ProjectDriveRefusal = "not_member" | "not_producer" | "not_keeper";

function isOwner(actor: ProjectDriveActor) {
  return actor.ownerUserId != null && actor.userId === actor.ownerUserId;
}

/** Хранитель — активный продюсер с этим участием (владение не нужно и не мешает). */
export function isDriveKeeper(actor: ProjectDriveActor, drive: ProjectDriveState | null): boolean {
  return (
    drive?.status === "ACTIVE" &&
    actor.membershipId != null &&
    drive.keeperMembershipId === actor.membershipId &&
    actor.isProducer
  );
}

/**
 * Подключить диск проекта (authorize и повторно callback):
 * - диска нет или он отключён — владелец проекта или активный продюсер;
 * - диск активен — это замена: только хранитель или владелец.
 */
export function projectDriveConnectRefusal(
  actor: ProjectDriveActor,
  drive: ProjectDriveState | null,
): ProjectDriveRefusal | null {
  if (!actor.membershipId) return "not_member";
  if (!isOwner(actor) && !actor.isProducer) return "not_producer";
  if (drive?.status === "ACTIVE" && !isOwner(actor) && !isDriveKeeper(actor, drive)) {
    return "not_keeper";
  }
  return null;
}

/** Отключить или заменить активный диск — хранитель или владелец. */
export function canManageProjectDrive(actor: ProjectDriveActor, drive: ProjectDriveState | null) {
  if (drive?.status !== "ACTIVE" || !actor.membershipId) return false;
  return isOwner(actor) || isDriveKeeper(actor, drive);
}

/** Видеть раздел «Диск проекта» и плашки — владелец и продюсеры. */
export function canSeeProjectDrive(actor: ProjectDriveActor) {
  return actor.membershipId != null && (isOwner(actor) || actor.isProducer);
}

/**
 * Хранитель всё ещё хранитель после изменения его участия: активен и продюсер.
 * Нет — диск проекта отключается (в той же транзакции, что и изменение).
 */
export function keeperStillValid(membership: { active: boolean; isProducer: boolean } | null) {
  return membership != null && membership.active && membership.isProducer;
}

/**
 * Новое подключение начинается с чистого листа (старые папки и выгрузки диска отвязываются),
 * кроме переподключения того же аккаунта к активному диску (например, после «доступ отозван»):
 * папки лежат в том же аккаунте, и приложение снова видит их по `drive.file`.
 */
export function projectDriveCleanSlate(
  existing: (ProjectDriveState & { accountSubject: string | null }) | null,
  newAccountSubject: string | null,
): boolean {
  if (!existing) return false;
  if (existing.status !== "ACTIVE") return true;
  return !existing.accountSubject || existing.accountSubject !== newAccountSubject;
}

/** Что сказать продюсерам плашкой: диск отключён из-за хранителя / доступ отозван. */
export type ProjectDriveAlert = "keeper_left" | "reconnect";

export function projectDriveAlert(
  drive: (ProjectDriveState & { detachReason: string | null; needsReconnect: boolean }) | null,
): ProjectDriveAlert | null {
  if (!drive) return null;
  if (drive.status === "DETACHED") {
    return drive.detachReason === PROJECT_DRIVE_DETACH_REASON.keeperLeft ? "keeper_left" : null;
  }
  return drive.needsReconnect ? "reconnect" : null;
}

export const projectDriveAlertText: Record<ProjectDriveAlert, string> = {
  keeper_left: "Диск проекта отключён — подключите новый",
  reconnect: "Диск проекта: доступ отозван или истёк — нужно переподключить",
};

/** Предупреждение в окнах смены роли / удаления участника, если это хранитель (дополнение 1). */
export const DRIVE_KEEPER_WARNING =
  "Это хранитель диска проекта — диск отключится, новые папки и ссылки придётся создавать заново";

/** Подсказка в окне подключения (вопрос 3). */
export const PROJECT_DRIVE_ACCOUNT_HINT =
  "Лучше подключить служебный аккаунт компании: файлы остаются в аккаунте того, кто подключил";
