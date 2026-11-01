import { AppHeader } from "@/features/auth/components/app-header";
import { awaitingApprovalCount } from "@/features/call-sheets/lib/awaiting-approval";
import { countCallSheetsAwaitingApproval } from "@/features/call-sheets/queries";
import { ProjectShell } from "@/features/projects/components/project-shell";
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
  const navGroups = withNavCount(
    filterNavGroups(projectNavGroups, navAccessFromContext(ctx)),
    "/call-sheets",
    inReview,
  );

  return (
    <>
      <AppHeader locale={locale} />
      <ProjectShell
        locale={locale}
        project={ctx.project}
        role={ctx.role}
        navGroups={navGroups}
      >
        {children}
      </ProjectShell>
    </>
  );
}
