import { isProducerRole } from "@/features/roles/role-rules";
import {
  projectDriveConnectRefusal,
  type ProjectDriveState,
} from "@/features/cloud/lib/project-drive-rules";
import type { CloudConnectPurpose } from "@/features/cloud/lib/token-crypto";

export type CloudConnectRefusal = "no_project" | "not_member" | "not_producer" | "not_keeper";

/**
 * Можно ли начать / завершить подключение диска. Проверяется в authorize и повторно в callback:
 * state живёт 10 минут, за это время человека могли удалить из проекта или понизить.
 * - `personal` — свой диск, проект не нужен; если проект передан — человек должен в нём быть;
 * - `project` — владелец проекта или активный продюсер (решение по вопросу 1); если диск
 *   проекта уже активен — это замена: только хранитель или владелец.
 */
export function cloudConnectRefusal(input: {
  purpose: CloudConnectPurpose;
  projectId: string | null;
  userId: string;
  /** Проект с активным участием этого человека; null — проекта нет или человек не участник. */
  project: {
    ownerUserId: string | null;
    role: { isSystem: boolean; name: string } | null;
    /** Активное участие этого человека (хранитель диска сравнивается по нему). */
    membershipId: string;
    /** Диск проекта, если его когда-то подключали. */
    drive?: ProjectDriveState | null;
  } | null;
}): CloudConnectRefusal | null {
  if (input.purpose === "project" && !input.projectId) return "no_project";
  if (!input.projectId) return null;
  if (!input.project?.role) return "not_member";
  if (input.purpose === "personal") return null;
  return projectDriveConnectRefusal(
    {
      userId: input.userId,
      membershipId: input.project.membershipId,
      isProducer: isProducerRole(input.project.role),
      ownerUserId: input.project.ownerUserId,
    },
    input.project.drive ?? null,
  );
}

export const cloudConnectRefusalText: Record<CloudConnectRefusal, string> = {
  no_project: "Не указан проект",
  not_member: "Нет доступа к проекту",
  not_producer: "Подключить диск проекта может владелец проекта или продюсер",
  not_keeper: "Заменить диск проекта может его хранитель или владелец проекта",
};
