"use client";

import { useActionState, useEffect, useState } from "react";
import type { ImportPreviewScene } from "@/features/import/types";
import {
  applyLibrettoSyncAction,
  previewLibrettoSyncAction,
} from "@/features/screenplay/actions";
import { LibrettoPreviewTable } from "@/features/screenplay/components/libretto-preview-table";
import { Modal } from "@/shared/ui/modal";
import { Button } from "@/shared/ui/button";
import { useActionToast, useToast } from "@/shared/ui/toast";

type Props = {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
  projectId: string;
  versionId: string;
};

export function ScreenplayLibrettoSyncPanel({
  open,
  onClose,
  onApplied,
  projectId,
  versionId,
}: Props) {
  const toast = useToast();
  const [scenes, setScenes] = useState<ImportPreviewScene[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void previewLibrettoSyncAction(projectId, versionId).then((result) => {
      if ("error" in result) {
        toast.error(result.error ?? "Ошибка загрузки");
        setScenes(null);
      } else {
        setScenes(result.scenes);
      }
      setLoading(false);
    });
  }, [open, projectId, versionId, toast]);

  const bound = applyLibrettoSyncAction.bind(null, projectId, versionId);
  const [state, formAction, pending] = useActionState(
    async (prev: { error?: string; success?: string }, formData: FormData) => {
      if (!scenes) return { error: "Нет данных предпросмотра" };
      return bound(JSON.stringify(scenes), formData);
    },
    {},
  );
  useActionToast(state);

  useEffect(() => {
    if (state.success) {
      onApplied?.();
    }
  }, [state.success, onApplied]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Обновить либретто из версии"
      wide
    >
      <p className="mb-4 text-sm text-[var(--muted-fg)]">
        Сравните данные версии сценария с записями в либретто. После применения
        эта версия станет текущей.
      </p>

      {loading ? (
        <p className="text-sm text-[var(--muted-fg)]">Загрузка…</p>
      ) : null}

      {scenes && scenes.length > 0 ? (
        <form action={formAction}>
          <LibrettoPreviewTable scenes={scenes} />
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Применение…" : "Обновить либретто"}
            </Button>
          </div>
        </form>
      ) : null}

      {scenes && scenes.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          В версии нет шапок сцен (SLUGLINE) для синхронизации.
        </p>
      ) : null}
    </Modal>
  );
}
