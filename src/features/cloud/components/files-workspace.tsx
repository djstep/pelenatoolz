"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CloudProvider, ProjectFileKind } from "@prisma/client";
import {
  attachCloudLinkAction,
  deleteCloudFileLinkAction,
} from "@/features/cloud/actions";
import {
  CloudReconnectNotice,
  type CloudConnectionView,
} from "@/features/cloud/components/cloud-file-picker";
import { linkSiteLabel, safeExternalHref } from "@/features/cloud/lib/cloud-link";
import {
  cloudProviderLabels,
  formatFileSize,
} from "@/features/cloud/lib/types";
import { deleteProjectUploadedFileAction } from "@/features/files/actions";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { useToast } from "@/shared/ui/toast";

type FileLink = {
  id: string;
  provider: CloudProvider | null;
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
  contractsOnly: boolean;
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
  canWriteContracts,
}: {
  locale: string;
  projectId: string;
  connections: CloudConnectionView[];
  files: FileLink[];
  uploadedFiles: UploadedFile[];
  canWrite: boolean;
  canWriteContracts: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirmDelete = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  function openLinkModal() {
    setLinkName("");
    setLinkUrl("");
    setLinkError(null);
    setLinkOpen(true);
  }

  function attachLink() {
    startTransition(async () => {
      const result = await attachCloudLinkAction(projectId, {
        name: linkName,
        url: linkUrl,
      });
      if (result.error) {
        setLinkError(result.error);
        return;
      }
      setLinkOpen(false);
      toast.success(result.success ?? "Ссылка прикреплена");
      router.refresh();
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
          <h2 className="font-display text-[27px] font-bold leading-tight">Файлы</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Загрузка с устройства · ссылки на Google Диск, Яндекс Диск и другие сайты
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
              onClick={openLinkModal}
              disabled={busy}
            >
              + Вставить ссылку
            </Button>
          </div>
        ) : null}
      </div>

      {message ? (
        <p className="text-sm text-[var(--muted-fg)]">{message}</p>
      ) : null}

      <CloudReconnectNotice
        connections={connections}
        returnTo={`/${locale}/projects/${projectId}/files`}
      />
      <p className="text-sm text-[var(--muted-fg)]">
        Личные Google Диск и Яндекс Диск подключаются в{" "}
        <Link href={`/${locale}/profile`} className="text-[var(--accent)] hover:underline">
          профиле
        </Link>
        .
      </p>

      <section className="glass-card overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="font-display text-base font-bold">
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
                      {canWrite && (!file.contractsOnly || canWriteContracts) ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void confirmDelete({
                              title: `Удалить файл „${file.originalName}“?`,
                              details: ["Из договоров и актов файл уберётся."],
                              action: async () => {
                                const result = await deleteProjectUploadedFileAction(
                                  projectId,
                                  file.id,
                                );
                                if (result.error) return result.error;
                                toast.success(result.success ?? "Удалено");
                                router.refresh();
                              },
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
          <h3 className="font-display text-base font-bold">
            Ссылки
          </h3>
        </div>
        {files.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted-fg)]">
            Пока нет прикреплённых ссылок. Нажмите «Вставить ссылку».
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
                      {safeExternalHref(file.webUrl) ? (
                        <a
                          href={safeExternalHref(file.webUrl)!}
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
                      {file.provider
                        ? cloudProviderLabels[file.provider]
                        : linkSiteLabel(file.webUrl)}
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
                            void confirmDelete({
                              title: `Удалить ссылку на „${file.name}“?`,
                              action: async () => {
                                await deleteCloudFileLinkAction(projectId, file.id);
                                router.refresh();
                              },
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

      <Modal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title="Вставить ссылку"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setLinkOpen(false)}>
              Отмена
            </Button>
            <Button type="button" disabled={pending} onClick={attachLink}>
              {pending ? "Сохранение…" : "Прикрепить"}
            </Button>
          </div>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            attachLink();
          }}
        >
          <div>
            <Label htmlFor="cloud-link-name">Название</Label>
            <Input
              id="cloud-link-name"
              value={linkName}
              maxLength={200}
              onChange={(e) => setLinkName(e.target.value)}
              placeholder="Например: раскадровка, 1 серия"
            />
          </div>
          <div>
            <Label htmlFor="cloud-link-url">Адрес</Label>
            <Input
              id="cloud-link-url"
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <p className="text-xs text-[var(--muted-fg)]">
            Любая ссылка, начинающаяся с https:// — Google Диск, Яндекс Диск и другие сайты. Доступ к самому
            файлу выдаётся там, где он лежит.
          </p>
          {linkError ? (
            <p className="text-sm text-[var(--danger)]">{linkError}</p>
          ) : null}
          <button type="submit" className="hidden" />
        </form>
      </Modal>
    </div>
  );
}
