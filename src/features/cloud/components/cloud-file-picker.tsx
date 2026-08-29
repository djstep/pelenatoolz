"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { CloudProvider } from "@prisma/client";
import { disconnectCloudAction } from "@/features/cloud/actions";
import {
  cloudProviderLabels,
  type CloudEntry,
} from "@/features/cloud/lib/types";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/ui/modal";
import { cn } from "@/shared/lib/cn";

type Connection = {
  id: string;
  provider: CloudProvider;
  accountEmail: string | null;
  accountLabel: string | null;
};

export function CloudFilePicker({
  projectId,
  locale,
  returnPath,
  open,
  onClose,
  connections,
  onAttach,
}: {
  projectId: string;
  locale: string;
  returnPath: string;
  open: boolean;
  onClose: () => void;
  connections: Connection[];
  onAttach: (file: CloudEntry & { provider: CloudProvider }) => void;
}) {
  const [provider, setProvider] = useState<CloudProvider | null>(
    connections[0]?.provider ?? null,
  );
  const [folderStack, setFolderStack] = useState<
    { id: string; name: string }[]
  >([]);
  const [items, setItems] = useState<CloudEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentFolder = folderStack[folderStack.length - 1];

  const load = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    setError(null);
    try {
      const folderKey =
        provider === "GOOGLE_DRIVE"
          ? currentFolder?.id ?? "root"
          : currentFolder?.id ?? "/";
      const res = await fetch(
        `/api/cloud/files?provider=${provider}&folder=${encodeURIComponent(folderKey)}`,
      );
      const data = (await res.json()) as {
        items?: CloudEntry[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Не удалось загрузить файлы");
      }
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [provider, currentFolder?.id]);

  useEffect(() => {
    if (!open || !provider) return;
    void load();
  }, [open, provider, load]);

  useEffect(() => {
    if (!open) return;
    setFolderStack([]);
    setProvider(connections[0]?.provider ?? null);
  }, [open, connections]);

  const returnTo = `/${locale}/projects/${projectId}${returnPath}`;

  return (
    <Modal open={open} onClose={onClose} title="Выбор файла из облака" wide>
      {connections.length === 0 ? (
        <div className="space-y-3 text-sm">
          <p className="text-[var(--muted-fg)]">
            Сначала подключите Google Диск или Яндекс.Диск.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/cloud/google/authorize?projectId=${projectId}&returnTo=${encodeURIComponent(returnTo)}`}
            >
              <Button type="button">Google Диск</Button>
            </a>
            <a
              href={`/api/cloud/yandex/authorize?projectId=${projectId}&returnTo=${encodeURIComponent(returnTo)}`}
            >
              <Button type="button" variant="secondary">
                Яндекс.Диск
              </Button>
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {connections.map((c) => (
              <Button
                key={c.id}
                type="button"
                variant={provider === c.provider ? "primary" : "secondary"}
                onClick={() => {
                  setProvider(c.provider);
                  setFolderStack([]);
                }}
              >
                {cloudProviderLabels[c.provider]}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button
              type="button"
              variant="ghost"
              disabled={folderStack.length === 0}
              onClick={() => setFolderStack((s) => s.slice(0, -1))}
            >
              ← Назад
            </Button>
            <span className="text-[var(--muted-fg)]">
              {currentFolder?.name ??
                (provider === "GOOGLE_DRIVE" ? "Мой диск" : "Диск")}
            </span>
          </div>

          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

          <div className="max-h-80 overflow-y-auto rounded-xl border border-[var(--border)]">
            {loading ? (
              <p className="p-4 text-sm text-[var(--muted-fg)]">Загрузка…</p>
            ) : items.length === 0 ? (
              <p className="p-4 text-sm text-[var(--muted-fg)]">Пусто</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-[var(--surface-2)]",
                        item.kind === "folder" && "font-medium",
                      )}
                      onClick={() => {
                        if (item.kind === "folder") {
                          setFolderStack((s) => [
                            ...s,
                            { id: item.id, name: item.name },
                          ]);
                          return;
                        }
                        if (!provider) return;
                        onAttach({ ...item, provider });
                        onClose();
                      }}
                    >
                      <span>
                        {item.kind === "folder" ? "📁 " : "📄 "}
                        {item.name}
                      </span>
                      {item.kind === "file" && item.sizeBytes != null ? (
                        <span className="text-xs text-[var(--muted-fg)]">
                          {Math.round(item.sizeBytes / 1024)} KB
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function CloudConnectionsPanel({
  projectId,
  locale,
  connections,
}: {
  projectId: string;
  locale: string;
  connections: Connection[];
}) {
  const returnTo = `/${locale}/projects/${projectId}/files`;
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/cloud/google/authorize?projectId=${projectId}&returnTo=${encodeURIComponent(returnTo)}`}
        >
          <Button type="button" variant="secondary">
            {connections.some((c) => c.provider === "GOOGLE_DRIVE")
              ? "Переподключить Google"
              : "Подключить Google Диск"}
          </Button>
        </a>
        <a
          href={`/api/cloud/yandex/authorize?projectId=${projectId}&returnTo=${encodeURIComponent(returnTo)}`}
        >
          <Button type="button" variant="secondary">
            {connections.some((c) => c.provider === "YANDEX_DISK")
              ? "Переподключить Яндекс"
              : "Подключить Яндекс.Диск"}
          </Button>
        </a>
      </div>

      {connections.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {connections.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2"
            >
              <div>
                <p className="font-medium">{cloudProviderLabels[c.provider]}</p>
                <p className="text-[var(--muted-fg)]">
                  {c.accountEmail ?? c.accountLabel ?? "Подключено"}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await disconnectCloudAction(c.id);
                  })
                }
              >
                Отключить
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--muted-fg)]">
          Облака не подключены. После OAuth вы сможете просматривать файлы и
          прикреплять их к проекту.
        </p>
      )}
    </div>
  );
}
