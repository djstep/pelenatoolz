import { requireProjectContext } from "@/features/projects/lib/project-context";
import { FilesWorkspace } from "@/features/cloud/components/files-workspace";
import {
  listProjectCloudFiles,
  listUserCloudConnections,
} from "@/features/cloud/lib/cloud-service";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ProjectFilesPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read") && !ctx.can("project:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к файлам</p>;
  }

  const [connections, files] = await Promise.all([
    listUserCloudConnections(ctx.user.id!),
    listProjectCloudFiles(projectId),
  ]);

  const canWrite = ctx.can("script:write") || ctx.can("project:write");

  return (
    <FilesWorkspace
      locale={locale}
      projectId={projectId}
      connections={connections}
      files={files.map((file) => ({
        ...file,
        sizeBytes: file.sizeBytes != null ? Number(file.sizeBytes) : null,
        createdAt: file.createdAt.toISOString(),
      }))}
      canWrite={canWrite}
    />
  );
}
