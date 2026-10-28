"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  removeMemberAction,
  updateMemberRoleAction,
} from "@/features/projects/actions";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

type RoleOption = { id: string; name: string };

type MemberRow = {
  id: string;
  role: RoleOption;
  user: { id: string; name: string; email: string };
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

  if (members.length === 0) {
    return <p className="text-sm text-[var(--muted-fg)]">{t("noMembers")}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
            <th className="py-2 pr-3 font-medium">Имя</th>
            <th className="py-2 pr-3 font-medium">Email</th>
            <th className="py-2 pr-3 font-medium">{t("role")}</th>
            {canManage ? <th className="py-2 font-medium" /> : null}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="border-b border-[var(--border)]/70">
              <td className="py-3 pr-3 font-medium">{member.user.name}</td>
              <td className="py-3 pr-3 text-[var(--muted-fg)]">
                {member.user.email}
              </td>
              <td className="py-3 pr-3 align-middle">
                {canManage && member.user.id !== currentUserId ? (
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
              {canManage ? (
                <td className="py-3 text-right">
                  {member.user.id !== currentUserId ? (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() =>
                        void confirmDelete({
                          title: `Удалить участника „${member.user.name}“ из проекта?`,
                          details: ["Доступ к проекту отключится, его данные в проекте останутся."],
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
