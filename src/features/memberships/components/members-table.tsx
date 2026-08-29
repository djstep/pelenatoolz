"use client";

import { useTranslations } from "next-intl";
import {
  removeMemberAction,
  updateMemberRoleAction,
} from "@/features/projects/actions";
import { Button } from "@/shared/ui/button";
import { Select } from "@/shared/ui/select";

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
              <td className="py-3 pr-3">
                {canManage ? (
                  <form
                    action={async (formData) => {
                      await updateMemberRoleAction(projectId, {}, formData);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input type="hidden" name="membershipId" value={member.id} />
                    <Select
                      name="roleId"
                      defaultValue={member.role.id}
                      className="w-auto min-w-[10rem]"
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </Select>
                  </form>
                ) : (
                  member.role.name
                )}
              </td>
              {canManage ? (
                <td className="py-3 text-right">
                  {member.user.id !== currentUserId ? (
                    <form
                      action={async () => {
                        await removeMemberAction(member.id, projectId);
                      }}
                    >
                      <Button type="submit" variant="danger">
                        {t("remove")}
                      </Button>
                    </form>
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
