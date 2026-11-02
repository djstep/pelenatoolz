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
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(251,113,133,0.35)] bg-[rgba(251,113,133,0.08)] px-3 py-2 text-sm"
    >
      <span>{projectDriveAlertText[alert]}</span>
      <Link href={settingsHref} className="font-medium underline underline-offset-2">
        Настройки проекта → Диск проекта
      </Link>
    </div>
  );
}
