import Link from "next/link";
import { CloudOAuthNoticeLine } from "@/features/cloud/components/cloud-oauth-notice";
import { ProjectDrivePanel } from "@/features/cloud/components/project-drive-panel";
import { projectDriveOAuthNotice } from "@/features/cloud/lib/oauth-notice";
import {
  canManageProjectDrive,
  canSeeProjectDrive,
} from "@/features/cloud/lib/project-drive-rules";
import {
  getProjectDriveView,
  projectDriveActor,
} from "@/features/cloud/lib/project-drive-service";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canOpenProjectSettings } from "@/features/projects/lib/project-list-access";
import { ProjectDangerZone } from "@/features/projects/components/project-danger-zone";
import { ProjectSettingsForm } from "@/features/projects/components/project-settings-form";
import { Card } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectSettingsPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const query = await searchParams;
  const ctx = await requireProjectContext(projectId);

  const canWrite = ctx.can("project:write");
  const canManage = ctx.can("project:archive");

  if (!canOpenProjectSettings(ctx.can)) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к настройкам</p>;
  }

  // Диск проекта — владельцу и продюсерам (почта аккаунта и хранитель — только им).
  const driveActor = projectDriveActor(ctx);
  const showDrive = canSeeProjectDrive(driveActor);
  const drive = showDrive ? await getProjectDriveView(projectId) : null;
  const driveNotice = showDrive ? projectDriveOAuthNotice(query, drive) : null;
  const formatWhen = (value: Date) =>
    value.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: ctx.project.timezone || "Europe/Moscow",
    });

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

      {showDrive ? (
        <Card>
          <h3 className="mb-1 font-display text-lg font-semibold">Диск проекта</h3>
          <p className="mb-4 text-sm text-[var(--muted-fg)]">
            Google Диск, куда система выгружает документы для просмотра и согласования.
          </p>
          {driveNotice ? <CloudOAuthNoticeLine notice={driveNotice} /> : null}
          <ProjectDrivePanel
            projectId={projectId}
            returnTo={`/${locale}/projects/${projectId}/settings`}
            canManage={canManageProjectDrive(driveActor, drive)}
            drive={
              drive
                ? {
                    status: drive.status,
                    accountEmail: drive.accountEmail,
                    keeperName: drive.keeperName,
                    connectedAtText: formatWhen(drive.connectedAt),
                    detachedAtText: drive.detachedAt ? formatWhen(drive.detachedAt) : null,
                    needsReconnect: drive.needsReconnect,
                  }
                : null
            }
          />
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
            canDelete={ctx.project.ownerUserId === ctx.user.id}
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
