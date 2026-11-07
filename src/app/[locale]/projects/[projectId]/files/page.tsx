import { requireProjectContext } from "@/features/projects/lib/project-context";
import { CloudOAuthNoticeLine } from "@/features/cloud/components/cloud-oauth-notice";
import { FilesWorkspace } from "@/features/cloud/components/files-workspace";
import { cloudOAuthNotice } from "@/features/cloud/lib/oauth-notice";
import {
  listProjectCloudFiles,
  listUserCloudConnections,
} from "@/features/cloud/lib/cloud-service";
import { listProjectUploadedFiles } from "@/features/files/queries";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectFilesPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const query = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read") && !ctx.can("project:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к файлам</p>;
  }

  const [connections, cloudFiles, uploadedFiles] = await Promise.all([
    listUserCloudConnections(ctx.user.id!),
    listProjectCloudFiles(projectId),
    listProjectUploadedFiles(projectId, ctx.can("contracts:read")),
  ]);
  const notice = cloudOAuthNotice(query, connections);

  const canWrite = ctx.can("script:write") || ctx.can("project:write");

  return (
    <>
    {notice ? <CloudOAuthNoticeLine notice={notice} /> : null}
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
      canWriteContracts={ctx.can("contracts:write")}
    />
    </>
  );
}
