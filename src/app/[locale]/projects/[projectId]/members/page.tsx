import { MembershipStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { getProjectDriveState } from "@/features/cloud/lib/project-drive-service";
import { isProducerRole } from "@/features/roles/role-rules";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canManageMembers } from "@/features/memberships/permissions";
import { MEMBERS_PAGES_PERMISSION } from "@/features/memberships/lib/members-pages-access";
import { InviteForm } from "@/features/memberships/components/invite-form";
import { inviteOrigin } from "@/features/memberships/lib/invite-origin";
import { InvitesList } from "@/features/memberships/components/invites-list";
import { MembersTable } from "@/features/memberships/components/members-table";
import {
  listProjectInvites,
  listProjectMembers,
  listProjectRoles,
} from "@/features/memberships/queries";
import { Card } from "@/shared/ui/card";

// Vercel: выгрузка на диск (предел 50 с), OAuth дисков и пересчёт доступов к папкам после ответа (`after()`) — до 60 с.
export const maxDuration = 60;

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ProjectMembersPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);
  const t = await getTranslations("members");

  if (!ctx.can(MEMBERS_PAGES_PERMISSION)) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const manage = canManageMembers(ctx.matrix);
  const [members, invites, roles, drive] = await Promise.all([
    listProjectMembers(projectId),
    manage ? listProjectInvites(projectId) : Promise.resolve([]),
    listProjectRoles(projectId),
    // Хранитель активного диска проекта — предупреждение в окнах смены роли и удаления.
    manage ? getProjectDriveState(projectId) : Promise.resolve(null),
  ]);
  const driveKeeperMembershipId =
    drive?.status === "ACTIVE" ? drive.keeperMembershipId : null;

  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name, isProducer: isProducerRole(r) }));
  const appUrl = await inviteOrigin();
  const ownerUserId = ctx.project.ownerUserId;
  const viewerIsOwner = ownerUserId === ctx.user.id;

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
              isOwner: m.userId === ownerUserId,
              isDriveKeeper: m.id === driveKeeperMembershipId,
              // Кому можно передать владение — считается только для владельца.
              canReceiveOwnership:
                viewerIsOwner &&
                m.userId !== ownerUserId &&
                m.status === MembershipStatus.ACTIVE &&
                isProducerRole(m.role),
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
              <InviteForm
                projectId={projectId}
                roles={roleOptions.map((r) => ({ id: r.id, name: r.name }))}
              />
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
