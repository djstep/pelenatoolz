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
import { ROLE_PRESETS } from "@/features/roles/role-presets";
import { prisma } from "@/shared/db/prisma";
import { Card } from "@/shared/ui/card";

// Vercel (Fluid compute, потолок 300 с): выгрузка на диск (до 50 с) и пересчёт доступов к папкам после ответа
// (`after()`, до 40 с) идут в одной функции — до 120 с. OAuth дисков — здесь же.
export const maxDuration = 120;

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ProjectMembersPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);
  const t = await getTranslations("members");

  if (!ctx.can(MEMBERS_PAGES_PERMISSION)) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const manage = canManageMembers(ctx.matrix);
  const [members, invites, roles, drive, departments] = await Promise.all([
    listProjectMembers(projectId),
    manage ? listProjectInvites(projectId) : Promise.resolve([]),
    listProjectRoles(projectId),
    // Хранитель активного диска проекта — предупреждение в окнах смены роли и удаления.
    manage ? getProjectDriveState(projectId) : Promise.resolve(null),
    // Цех в приглашении: кто примет — станет его главой.
    manage
      ? prisma.department.findMany({
          where: { projectId },
          select: {
            id: true,
            name: true,
            // Нынешние главы — предупреждение в форме: прежний глава не снимается.
            heads: {
              where: { membership: { status: MembershipStatus.ACTIVE } },
              select: { membership: { select: { user: { select: { name: true, email: true } } } } },
            },
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        })
      : Promise.resolve([]),
  ]);
  const departmentOptions = departments.map((d) => ({
    id: d.id,
    name: d.name,
    heads: d.heads.map((h) => h.membership.user.name || h.membership.user.email || "участник"),
  }));
  // Роли из шаблонов — кнопки быстрого выбора в порядке ROLE_PRESETS; список ролей — как был.
  const presetIndex = new Map(ROLE_PRESETS.map((p, index) => [p.key as string, index]));
  const inviteRoles = roles.map((r) => {
    const index = r.presetKey ? presetIndex.get(r.presetKey) : undefined;
    return {
      id: r.id,
      name: r.name,
      note: r.note,
      presetOrder: index ?? null,
      departmentHead: index !== undefined && ROLE_PRESETS[index]!.departmentHead,
    };
  });
  const driveKeeperMembershipId =
    drive?.status === "ACTIVE" ? drive.keeperMembershipId : null;

  const roleOptions = roles.map((r) => ({ id: r.id, name: r.name, isProducer: isProducerRole(r) }));
  const appUrl = await inviteOrigin();
  const ownerUserId = ctx.project.ownerUserId;
  const viewerIsOwner = ownerUserId === ctx.user.id;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[27px] font-bold leading-tight">{t("title")}</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Роли, приглашения и доступ к модулям проекта.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* min-w-0: широкая таблица прокручивается внутри карточки, а не растягивает страницу. */}
        <Card className="min-w-0">
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
              <h3 className="mb-4 font-display text-base font-bold">
                {t("invite")}
              </h3>
              <InviteForm
                projectId={projectId}
                locale={locale}
                roles={inviteRoles}
                departments={departmentOptions}
              />
            </Card>
            <InvitesList
              projectId={projectId}
              // В браузер — только то, что показывает список (без прав роли и автора).
              invites={invites.map((invite) => ({
                id: invite.id,
                token: invite.token,
                email: invite.email,
                role: { name: invite.role.name },
                department: invite.department,
                departmentName: invite.departmentName,
                expiresAt: invite.expiresAt,
              }))}
              appUrl={appUrl}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
