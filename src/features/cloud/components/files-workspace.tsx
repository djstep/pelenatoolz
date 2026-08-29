"use client";

import { useState, useTransition } from "react";
import type { CloudProvider } from "@prisma/client";
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
import { Button } from "@/shared/ui/button";

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

export function FilesWorkspace({
  locale,
  projectId,
  connections,
  files,
  canWrite,
}: {
  locale: string;
  projectId: string;
  connections: Connection[];
  files: FileLink[];
  canWrite: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">Файлы</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Google Диск и Яндекс.Диск: подключение, просмотр и ссылки на файлы
            проекта.
          </p>
        </div>
        {canWrite ? (
          <Button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={pending}
          >
            + Из облака
          </Button>
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
            Прикреплённые файлы
          </h3>
        </div>
        {files.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted-fg)]">
            Пока нет прикреплённых файлов.
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
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              await deleteCloudFileLinkAction(
                                projectId,
                                file.id,
                              );
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
