import { requireProjectContext } from "@/features/projects/lib/project-context";
import { FilesWorkspace } from "@/features/cloud/components/files-workspace";
import {
  listProjectCloudFiles,
  listUserCloudConnections,
} from "@/features/cloud/lib/cloud-service";
import { listProjectUploadedFiles } from "@/features/files/queries";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ProjectFilesPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read") && !ctx.can("project:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к файлам</p>;
  }

  const [connections, cloudFiles, uploadedFiles] = await Promise.all([
    listUserCloudConnections(ctx.user.id!),
    listProjectCloudFiles(projectId),
    listProjectUploadedFiles(projectId),
  ]);

  const canWrite = ctx.can("script:write") || ctx.can("project:write");

  return (
    <FilesWorkspace
      locale={locale}
      projectId={projectId}
      connections={connections}
      files={cloudFiles.map((file) => ({
        ...file,
        sizeBytes: file.sizeBytes != null ? Number(file.sizeBytes) : null,
        createdAt: file.createdAt.toISOString(),
      }))}
      uploadedFiles={uploadedFiles.map((file) => ({
        ...file,
        createdAt: file.createdAt.toISOString(),
      }))}
      canWrite={canWrite}
    />
  );
}
