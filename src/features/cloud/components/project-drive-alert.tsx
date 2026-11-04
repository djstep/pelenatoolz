import Link from "next/link";
import {
  projectDriveAlertText,
  type ProjectDriveAlert,
} from "@/features/cloud/lib/project-drive-rules";

/** Плашка продюсерам на страницах проекта: диск отключён из-за хранителя / доступ отозван. */
export function ProjectDriveAlertBanner({
  alert,
  settingsHref,
}: {
  alert: ProjectDriveAlert;
  settingsHref: string;
}) {
  return (
    <div
      role="alert"
      data-testid="project-drive-alert"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--tone-danger-line)] bg-[var(--tone-danger-bg)] px-3 py-2 text-sm"
    >
      <span>{projectDriveAlertText[alert]}</span>
      <Link href={settingsHref} className="font-medium underline underline-offset-2">
        Настройки проекта → Диск проекта
      </Link>
    </div>
  );
}
