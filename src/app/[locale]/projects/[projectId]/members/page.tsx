import { getTranslations } from "next-intl/server";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canManageMembers } from "@/features/memberships/permissions";
import { InviteForm } from "@/features/memberships/components/invite-form";
import { InvitesList } from "@/features/memberships/components/invites-list";
import { MembersTable } from "@/features/memberships/components/members-table";
import {
  listProjectInvites,
  listProjectMembers,
  listProjectRoles,
} from "@/features/memberships/queries";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ProjectMembersPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);
  const t = await getTranslations("members");

  const manage = canManageMembers(ctx.matrix);
  const [members, invites, roles] = await Promise.all([
    listProjectMembers(projectId),
    manage ? listProjectInvites(projectId) : Promise.resolve([]),
    listProjectRoles(projectId),
  ]);

  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name }));
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Роли, приглашения и доступ к модулям проекта.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <MembersTable
            projectId={projectId}
            members={members.map((m) => ({
              id: m.id,
              role: { id: m.role.id, name: m.role.name },
              user: m.user,
            }))}
            roles={roleOptions}
            currentUserId={ctx.user.id!}
            canManage={manage}
          />
        </Card>

        {manage ? (
          <div className="space-y-6">
            <Card>
              <h3 className="mb-4 font-display text-lg font-semibold">
                {t("invite")}
              </h3>
              <InviteForm projectId={projectId} roles={roleOptions} />
            </Card>
            <InvitesList
              projectId={projectId}
              invites={invites}
              appUrl={appUrl}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
