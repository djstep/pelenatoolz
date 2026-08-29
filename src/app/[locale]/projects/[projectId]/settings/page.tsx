import Link from "next/link";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { ProjectDangerZone } from "@/features/projects/components/project-danger-zone";
import { ProjectSettingsForm } from "@/features/projects/components/project-settings-form";
import { Card } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ProjectSettingsPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  const canWrite = ctx.can("project:write");
  const canManage = ctx.can("project:archive");

  if (!canWrite && !canManage) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к настройкам</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Настройки проекта</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Редактирование параметров, архивирование и удаление.
        </p>
      </div>

      {canWrite ? (
        <Card>
          <h3 className="mb-4 font-display text-lg font-semibold">
            Основные параметры
          </h3>
          <ProjectSettingsForm project={ctx.project} />
        </Card>
      ) : null}

      {canManage ? (
        <Card>
          <h3 className="mb-4 font-display text-lg font-semibold">
            Управление проектом
          </h3>
          <ProjectDangerZone
            projectId={projectId}
            projectName={ctx.project.name}
            status={ctx.project.status}
          />
        </Card>
      ) : null}

      <div>
        <Link href={`/${locale}/projects/${projectId}`}>
          <Button variant="secondary">← К обзору</Button>
        </Link>
      </div>
    </div>
  );
}
