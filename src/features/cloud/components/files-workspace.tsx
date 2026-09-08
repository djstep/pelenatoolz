"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CloudProvider, ProjectFileKind } from "@prisma/client";
import {
  attachCloudFileAction,
  deleteCloudFileLinkAction,
} from "@/features/cloud/actions";
import {
  CloudConnectionsPanel,
  CloudFilePicker,
} from "@/features/cloud/components/cloud-file-picker";
import {
  cloudProviderLabels,
  formatFileSize,
  type CloudEntry,
} from "@/features/cloud/lib/types";
import { deleteProjectUploadedFileAction } from "@/features/files/actions";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

type Connection = {
  id: string;
  provider: CloudProvider;
  accountEmail: string | null;
  accountLabel: string | null;
};

type FileLink = {
  id: string;
  provider: CloudProvider;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  webUrl: string | null;
  path: string | null;
  externalId: string;
  createdAt: string;
  connection: {
    accountEmail: string | null;
    provider: CloudProvider;
  } | null;
};

type UploadedFile = {
  id: string;
  kind: ProjectFileKind;
  status: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string | null;
  createdAt: string;
};

const KIND_LABELS: Record<ProjectFileKind, string> = {
  IMAGE: "Изображение",
  VIDEO: "Видео",
  OTHER: "Файл",
};

export function FilesWorkspace({
  locale,
  projectId,
  connections,
  files,
  uploadedFiles,
  canWrite,
}: {
  locale: string;
  projectId: string;
  connections: Connection[];
  files: FileLink[];
  uploadedFiles: UploadedFile[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  function attach(file: CloudEntry & { provider: CloudProvider }) {
    startTransition(async () => {
      const result = await attachCloudFileAction(projectId, {
        provider: file.provider,
        externalId: file.id,
        path: file.path,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        webUrl: file.webUrl,
      });
      setMessage(result.success ?? result.error ?? null);
      if (result.success) router.refresh();
    });
  }

  async function uploadFromDevice(fileList: FileList | null) {
    if (!fileList?.length || !canWrite) return;
    setUploading(true);
    setMessage(null);
    try {
      let ok = 0;
      let fail = 0;
      for (const file of Array.from(fileList)) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`/api/projects/${projectId}/uploads/file`, {
          method: "POST",
          body,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          originalName?: string;
        };
        if (!res.ok) {
          fail += 1;
          toast.error(data.error ?? `Не удалось загрузить «${file.name}»`);
        } else {
          ok += 1;
        }
      }
      if (ok > 0) {
        toast.success(
          ok === 1 ? "Файл загружен" : `Загружено файлов: ${ok}`,
        );
        router.refresh();
      }
      if (fail > 0 && ok === 0) {
        setMessage("Не удалось загрузить файлы");
      }
    } catch (err) {
      console.error("[files upload]", err);
      toast.error("Ошибка загрузки");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const busy = pending || uploading;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">Файлы</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Загрузка с устройства · Google Диск и Яндекс.Диск
          </p>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void uploadFromDevice(e.target.files);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Загрузка…" : "+ С устройства"}
            </Button>
            <Button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={busy}
            >
              + Из облака
            </Button>
          </div>
        ) : null}
      </div>

      {message ? (
        <p className="text-sm text-[var(--muted-fg)]">{message}</p>
      ) : null}

      <section className="glass-card p-4">
        <h3 className="mb-3 font-display text-lg font-semibold">
          Облачные диски
        </h3>
        <CloudConnectionsPanel
          projectId={projectId}
          locale={locale}
          connections={connections}
        />
      </section>

      <section className="glass-card overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="font-display text-lg font-semibold">
            Файлы с устройства
          </h3>
        </div>
        {uploadedFiles.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted-fg)]">
            Пока нет загруженных файлов. Нажмите «С устройства».
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="glass-table w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                  <th className="px-4 py-3 font-medium">Имя</th>
                  <th className="px-4 py-3 font-medium">Тип</th>
                  <th className="px-4 py-3 font-medium">Размер</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {uploadedFiles.map((file) => (
                  <tr
                    key={file.id}
                    className="border-b border-[var(--border)]/60"
                  >
                    <td className="px-4 py-3">
                      {file.url && file.status === "READY" ? (
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--accent)] hover:underline"
                        >
                          {file.originalName}
                        </a>
                      ) : (
                        <span>
                          {file.originalName}
                          {file.status !== "READY" ? (
                            <span className="ml-2 text-xs text-[var(--muted-fg)]">
                              ({file.status})
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-fg)]">
                      {KIND_LABELS[file.kind]}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-fg)]">
                      {formatFileSize(file.sizeBytes)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canWrite ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            startTransition(async () => {
                              const result =
                                await deleteProjectUploadedFileAction(
                                  projectId,
                                  file.id,
                                );
                              if (result.error) {
                                toast.error(result.error);
                                return;
                              }
                              toast.success(result.success ?? "Удалено");
                              router.refresh();
                            })
                          }
                        >
                          Удалить
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="glass-card overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="font-display text-lg font-semibold">
            Прикреплённые из облака
          </h3>
        </div>
        {files.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted-fg)]">
            Пока нет прикреплённых файлов из облака.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="glass-table w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                  <th className="px-4 py-3 font-medium">Имя</th>
                  <th className="px-4 py-3 font-medium">Источник</th>
                  <th className="px-4 py-3 font-medium">Размер</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr
                    key={file.id}
                    className="border-b border-[var(--border)]/60"
                  >
                    <td className="px-4 py-3">
                      {file.webUrl ? (
                        <a
                          href={file.webUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--accent)] hover:underline"
                        >
                          {file.name}
                        </a>
                      ) : (
                        file.name
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-fg)]">
                      {cloudProviderLabels[file.provider]}
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-fg)]">
                      {formatFileSize(
                        file.sizeBytes != null ? Number(file.sizeBytes) : null,
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canWrite ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            startTransition(async () => {
                              await deleteCloudFileLinkAction(
                                projectId,
                                file.id,
                              );
                              router.refresh();
                            })
                          }
                        >
                          Удалить
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CloudFilePicker
        projectId={projectId}
        locale={locale}
        returnPath="/files"
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        connections={connections}
        onAttach={attach}
      />
    </div>
  );
}
