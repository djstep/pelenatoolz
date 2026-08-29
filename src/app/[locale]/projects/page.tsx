import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppHeader } from "@/features/auth/components/app-header";
import { listUserProjects } from "@/features/projects/queries";
import { requireUser } from "@/features/auth/session";
import {
  projectStatusLabels,
  projectTypeLabels,
} from "@/shared/i18n/domain-labels";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { cn } from "@/shared/lib/cn";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ archived?: string }>;
};

export default async function ProjectsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const user = await requireUser();
  const projects = await listUserProjects(user.id!, { includeArchived: showArchived });
  const t = await getTranslations("projects");

  return (
    <>
      <AppHeader locale={locale} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {showArchived ? "Архивные проекты" : t("title")}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              {showArchived
                ? "Завершённые и скрытые проекты"
                : "Управление производством"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/${locale}/projects${showArchived ? "" : "?archived=1"}`}>
              <Button variant="secondary">
                {showArchived ? "Активные проекты" : "Архив"}
              </Button>
            </Link>
            {!showArchived ? (
              <Link href={`/${locale}/projects/new`}>
                <Button>{t("create")}</Button>
              </Link>
            ) : null}
          </div>
        </div>

        {projects.length === 0 ? (
          <Card>
            <p className="text-[var(--muted-fg)]">
              {showArchived ? "Архивных проектов нет." : t("empty")}
            </p>
            {!showArchived ? (
              <div className="mt-4">
                <Link href={`/${locale}/projects/new`}>
                  <Button>{t("create")}</Button>
                </Link>
              </div>
            ) : null}
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => {
              const role = project.memberships[0]?.role;
              return (
                <li key={project.id}>
                  <Card
                    className={cn(
                      "glass-hover h-full",
                      project.status === "ARCHIVED" && "opacity-80",
                    )}
                  >
                    <div className="mb-3 flex flex-wrap gap-2">
                      <Badge>{projectTypeLabels[project.type]}</Badge>
                      <Badge>{projectStatusLabels[project.status]}</Badge>
                    </div>
                    <h2 className="font-display text-xl font-semibold">
                      {project.name}
                    </h2>
                    <p className="mt-2 text-sm text-[var(--muted-fg)]">
                      {t("yourRole")}: {role ? role.name : "—"}
                      {" · "}
                      {t("membersCount", { count: project._count.memberships })}
                      {project.city ? (
                        <>
                          {" · "}
                          {project.city}
                        </>
                      ) : null}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link href={`/${locale}/projects/${project.id}`}>
                        <Button variant="secondary">{t("open")}</Button>
                      </Link>
                      <Link href={`/${locale}/projects/${project.id}/settings`}>
                        <Button variant="ghost">Настройки</Button>
                      </Link>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
