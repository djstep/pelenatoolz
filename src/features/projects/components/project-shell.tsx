import { ProjectStatus, ProjectType } from "@prisma/client";
import { ProjectNav } from "@/features/projects/components/project-nav";
import { projectNavGroups } from "@/features/projects/lib/project-nav-groups";
import {
  projectStatusLabels,
  projectTypeLabels,
} from "@/shared/i18n/domain-labels";
import { Badge } from "@/shared/ui/badge";

type Project = {
  id: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  currency: string;
  timezone: string;
};

type Role = {
  name: string;
};

export function ProjectShell({
  locale,
  project,
  role,
  children,
}: {
  locale: string;
  project: Project;
  role: Role;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col lg:flex-row">
      <aside className="w-full shrink-0 border-b border-[var(--border)] lg:w-60 lg:border-b-0 lg:border-r">
        <div className="project-sidebar sticky top-14 space-y-4 px-3 py-5 lg:max-h-[calc(100vh-3.5rem)] lg:overflow-y-auto lg:backdrop-blur-md">
          <div className="px-1">
            <div className="mb-3 flex flex-wrap gap-1.5">
              <Badge>{projectTypeLabels[project.type]}</Badge>
              <Badge>{projectStatusLabels[project.status]}</Badge>
            </div>
            <h1 className="font-display text-lg font-semibold leading-tight">
              {project.name}
            </h1>
            <p className="mt-1.5 text-xs text-[var(--muted-fg)]">
              {role.name} · {project.currency}
            </p>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent" />
          <ProjectNav
            locale={locale}
            projectId={project.id}
            groups={projectNavGroups}
          />
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-4 sm:px-5 lg:px-6 lg:py-5">
        {children}
      </main>
    </div>
  );
}
