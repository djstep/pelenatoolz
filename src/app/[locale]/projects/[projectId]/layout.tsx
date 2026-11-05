import { awaitingApprovalCount } from "@/features/call-sheets/lib/awaiting-approval";
import { countCallSheetsAwaitingApproval } from "@/features/call-sheets/queries";
import { ProjectDriveAlertBanner } from "@/features/cloud/components/project-drive-alert";
import { canSeeProjectDrive, projectDriveAlert } from "@/features/cloud/lib/project-drive-rules";
import { getProjectDriveView, projectDriveActor } from "@/features/cloud/lib/project-drive-service";
import { ProjectShell } from "@/features/projects/components/project-shell";
import { ProjectTabs } from "@/features/projects/components/project-tabs";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  filterNavGroups,
  navAccessFromContext,
  projectNavGroups,
  withNavCount,
} from "@/features/projects/lib/project-nav-groups";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ProjectLayout({ children, params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);
  // Вызывные на согласовании — только тому, кто может утвердить.
  const inReview = await awaitingApprovalCount(ctx.can, () =>
    countCallSheetsAwaitingApproval(projectId),
  );
  // Диск проекта отключён из-за хранителя или доступ отозван — плашка владельцу и продюсерам.
  const driveAlert = canSeeProjectDrive(projectDriveActor(ctx))
    ? projectDriveAlert(await getProjectDriveView(projectId))
    : null;
  const navGroups = withNavCount(
    filterNavGroups(projectNavGroups, navAccessFromContext(ctx)),
    "/call-sheets",
    inReview,
  );

  return (
    // Шапки в проекте нет: пользователь, тема и выход — в боковом меню (ProjectShell).
    <ProjectShell
      locale={locale}
      project={ctx.project}
      role={ctx.role}
      navGroups={navGroups}
    >
      {driveAlert ? (
        <ProjectDriveAlertBanner
          alert={driveAlert}
          settingsHref={`/${locale}/projects/${projectId}/settings`}
        />
      ) : null}
      <ProjectTabs base={`/${locale}/projects/${projectId}`} groups={navGroups} />
      {children}
    </ProjectShell>
  );
}
