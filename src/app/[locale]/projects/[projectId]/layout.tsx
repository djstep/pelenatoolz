import { AppHeader } from "@/features/auth/components/app-header";
import { ProjectShell } from "@/features/projects/components/project-shell";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  filterNavGroups,
  navAccessFromContext,
  projectNavGroups,
} from "@/features/projects/lib/project-nav-groups";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ProjectLayout({ children, params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);
  const navGroups = filterNavGroups(projectNavGroups, navAccessFromContext(ctx));

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
