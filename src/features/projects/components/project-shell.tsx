import { ProjectStatus, ProjectType } from "@prisma/client";
import { ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { MobileAccount, SidebarAccount } from "@/features/auth/components/project-account";
import {
  ProjectNav,
  type NavGroup,
} from "@/features/projects/components/project-nav";
import { ProjectSectionLabel } from "@/features/projects/components/project-section-label";
import { ProjectSidebar } from "@/features/projects/components/project-sidebar";
import {
  projectStatusLabels,
  projectTypeLabels,
} from "@/shared/i18n/domain-labels";
import { AppBrand } from "@/shared/ui/app-brand";

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
  navGroups,
  children,
}: {
  locale: string;
  project: Project;
  role: Role;
  /** Меню, уже отфильтрованное по правам пользователя (`filterNavGroups`). */
  navGroups: NavGroup[];
  children: React.ReactNode;
}) {
  const projectsHref = `/${locale}/projects`;

  return (
    <div className="flex h-dvh flex-col overflow-hidden lg:flex-row">
      <ProjectSidebar
        projectName={project.name}
        brand={
          <Link href={projectsHref} className="inline-flex shrink-0">
            <AppBrand size="sidebar" />
          </Link>
        }
        mobileAccount={<MobileAccount locale={locale} />}
        footer={<SidebarAccount locale={locale} />}
      >
        {/* Блок проекта: название, тип и статус, роль и валюта; клик — к списку проектов. */}
        <Link
          href={projectsHref}
          title={project.name}
          className="flex items-start gap-2 rounded-lg border border-[var(--sidebar-line)] bg-[var(--sidebar-hover)] px-3 py-2.5 transition-colors hover:border-[var(--sidebar-guide)]"
        >
          <span className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-bold leading-snug text-[var(--sidebar-fg)]">
              {project.name}
            </h1>
            <span className="mt-0.5 block truncate text-xs text-[var(--sidebar-fg-2)]">
              {projectTypeLabels[project.type]} · {projectStatusLabels[project.status]}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--sidebar-muted)]">
              {role.name} · {project.currency}
            </span>
            <span className="sr-only">— к списку проектов</span>
          </span>
          <ChevronsUpDown className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sidebar-muted)]" aria-hidden />
        </Link>
        <ProjectNav
          locale={locale}
          projectId={project.id}
          groups={navGroups}
        />
      </ProjectSidebar>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-4 py-4 sm:px-5 lg:px-8 lg:py-6">
        <ProjectSectionLabel base={`/${locale}/projects/${project.id}`} groups={navGroups} />
        {children}
      </main>
    </div>
  );
}
