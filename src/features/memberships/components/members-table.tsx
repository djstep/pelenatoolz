"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  removeMemberAction,
  transferOwnershipAction,
  updateMemberRoleAction,
} from "@/features/projects/actions";
import { DRIVE_KEEPER_WARNING } from "@/features/cloud/lib/project-drive-rules";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

type RoleOption = { id: string; name: string; isProducer: boolean };

type MemberRow = {
  id: string;
  role: { id: string; name: string };
  user: { id: string; name: string; email: string };
  /** Владелец проекта: его роль не меняется и он не удаляется. */
  isOwner: boolean;
  /** Смотрит владелец, а это активный продюсер — ему можно передать владение. */
  canReceiveOwnership: boolean;
  /** Хранитель диска проекта: смена роли на не продюсерскую и удаление отключат диск. */
  isDriveKeeper: boolean;
};

export function MembersTable({
  projectId,
  members,
  roles,
  currentUserId,
  canManage,
}: {
  projectId: string;
  members: MemberRow[];
  roles: RoleOption[];
  currentUserId: string;
  canManage: boolean;
}) {
  const t = useTranslations("members");
  const toast = useToast();
  const confirmDelete = useConfirm();
  const [pending, startTransition] = useTransition();
  // Меняется при отказе сервера: списки пересоздаются и снова показывают роль из базы.
  const [resetVersion, setResetVersion] = useState(0);

  function changeRole(member: MemberRow, roleId: string) {
    const formData = new FormData();
    formData.set("membershipId", member.id);
    formData.set("roleId", roleId);
    const newRole = roles.find((r) => r.id === roleId);
    // Хранитель диска проекта перестаёт быть продюсером — сначала окно с предупреждением.
    if (member.isDriveKeeper && newRole && !newRole.isProducer) {
      void confirmDelete({
        title: `Сменить роль «${member.user.name}» на «${newRole.name}»?`,
        details: [DRIVE_KEEPER_WARNING],
        confirmLabel: "Сменить роль",
        action: async () => {
          const result = await updateMemberRoleAction(projectId, {}, formData);
          if (result.error) return result.error;
          if (result.success) toast.success(result.success);
        },
      }).then((done) => {
        if (!done) setResetVersion((v) => v + 1);
      });
      return;
    }
    startTransition(async () => {
      const result = await updateMemberRoleAction(projectId, {}, formData);
      if (result.error) {
        setResetVersion((v) => v + 1);
        toast.error(result.error);
      } else if (result.success) {
        toast.success(result.success);
      }
    });
  }

  function transferOwnership(member: MemberRow) {
    void confirmDelete({
      title: `Передать владение «${member.user.name}»?`,
      details: ["Вы останетесь продюсером, но вас смогут понизить."],
      confirmLabel: "Передать",
      action: async () => {
        const result = await transferOwnershipAction(projectId, member.id);
        if (result.success) toast.success(result.success);
        return result.error;
      },
    });
  }

  if (members.length === 0) {
    return <p className="text-sm text-[var(--muted-fg)]">{t("noMembers")}</p>;
  }

  const showActions = canManage || members.some((m) => m.canReceiveOwnership);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
            <th className="py-2 pr-3 font-medium">Имя</th>
            <th className="py-2 pr-3 font-medium">Email</th>
            <th className="py-2 pr-3 font-medium">{t("role")}</th>
            {showActions ? <th className="py-2 font-medium" /> : null}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="border-b border-[var(--border)]/70">
              <td className="py-3 pr-3 font-medium">
                {member.user.name}
                {member.isOwner ? (
                  <Badge className="ml-2" title="Владельца нельзя понизить или удалить — только передать владение">
                    Владелец
                  </Badge>
                ) : null}
                {member.isDriveKeeper ? (
                  <Badge className="ml-2" title="Подключил диск проекта: файлы лежат в его аккаунте Google">
                    Хранитель диска
                  </Badge>
                ) : null}
              </td>
              <td className="py-3 pr-3 text-[var(--muted-fg)]">
                {member.user.email}
              </td>
              <td className="py-3 pr-3 align-middle">
                {canManage && member.user.id !== currentUserId && !member.isOwner ? (
                  <Select
                    key={`${member.id}-${member.role.id}-${resetVersion}`}
                    name="roleId"
                    defaultValue={member.role.id}
                    className="min-w-[10rem]"
                    disabled={pending}
                    onChange={(e) => changeRole(member, e.currentTarget.value)}
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  member.role.name
                )}
              </td>
              {showActions ? (
                <td className="space-x-2 whitespace-nowrap py-3 text-right">
                  {member.canReceiveOwnership ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => transferOwnership(member)}
                    >
                      Передать владение
                    </Button>
                  ) : null}
                  {canManage && member.user.id !== currentUserId && !member.isOwner ? (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() =>
                        void confirmDelete({
                          title: `Удалить участника „${member.user.name}“ из проекта?`,
                          details: [
                            "Доступ к проекту отключится, его данные в проекте останутся.",
                            ...(member.isDriveKeeper ? [DRIVE_KEEPER_WARNING] : []),
                          ],
                          action: async () =>
                            (await removeMemberAction(member.id, projectId)).error,
                        })
                      }
                    >
                      {t("remove")}
                    </Button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
