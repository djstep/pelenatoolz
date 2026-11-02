"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  checkProjectDriveAction,
  disconnectProjectDriveAction,
} from "@/features/cloud/project-drive-actions";
import { PROJECT_DRIVE_ACCOUNT_HINT } from "@/features/cloud/lib/project-drive-rules";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { Modal } from "@/shared/ui/modal";
import { useToast } from "@/shared/ui/toast";

/** Диск проекта для раздела настроек; даты уже отформатированы на сервере. */
export type ProjectDrivePanelView = {
  status: "ACTIVE" | "DETACHED";
  accountEmail: string | null;
  keeperName: string | null;
  connectedAtText: string;
  detachedAtText: string | null;
  needsReconnect: boolean;
};

type ConnectMode = "connect" | "replace" | "reconnect";

const CONNECT_TITLE: Record<ConnectMode, string> = {
  connect: "Подключить диск проекта",
  replace: "Заменить диск проекта",
  reconnect: "Переподключить диск проекта",
};

/**
 * «Настройки проекта» → «Диск проекта» (только Google): подключить — владелец или продюсер,
 * заменить / отключить — хранитель или владелец. Права проверяет сервер (authorize, callback,
 * действия); кнопки — только подсказка.
 */
export function ProjectDrivePanel({
  projectId,
  returnTo,
  drive,
  canManage,
}: {
  projectId: string;
  returnTo: string;
  drive: ProjectDrivePanelView | null;
  /** Хранитель или владелец: заменить, переподключить, отключить активный диск. */
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<ConnectMode | null>(null);
  const [checking, startCheck] = useTransition();
  const active = drive?.status === "ACTIVE";

  function check() {
    startCheck(async () => {
      const result = await checkProjectDriveAction(projectId);
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
      router.refresh();
    });
  }

  function disconnect() {
    void confirm({
      title: "Отключить диск проекта?",
      details: [
        "Система перестанет создавать папки и выгружать файлы на этот диск.",
        "Папки, файлы и выданные доступы останутся в аккаунте хранителя.",
        "Новый диск — с чистого листа: папки и ссылки придётся создавать заново.",
      ],
      confirmLabel: "Отключить",
      action: async () => {
        const result = await disconnectProjectDriveAction(projectId);
        if (result.error) return result.error;
        toast.success(result.success ?? "Диск проекта отключён");
        router.refresh();
      },
    });
  }

  return (
    <div className="space-y-3 text-sm" data-testid="project-drive">
      {active ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-[var(--muted-fg)]">Аккаунт</dt>
          <dd className="break-all" data-testid="project-drive-account">
            Google Диск · {drive.accountEmail ?? "почта не получена"}
          </dd>
          <dt className="text-[var(--muted-fg)]">Хранитель</dt>
          <dd data-testid="project-drive-keeper">{drive.keeperName ?? "—"}</dd>
          <dt className="text-[var(--muted-fg)]">Подключён</dt>
          <dd>{drive.connectedAtText}</dd>
          {drive.needsReconnect ? (
            <dd className="col-span-2 text-[var(--danger)]" data-testid="project-drive-reconnect">
              Доступ отозван или истёк — нужно переподключить (хранитель или владелец проекта).
            </dd>
          ) : null}
        </dl>
      ) : (
        <p className="text-[var(--muted-fg)]" data-testid="project-drive-status">
          {drive?.status === "DETACHED"
            ? `Не подключён. Прежний диск${drive.accountEmail ? ` (${drive.accountEmail})` : ""} отключён${
                drive.detachedAtText ? ` ${drive.detachedAtText}` : ""
              }: его папки и файлы остались в аккаунте прежнего хранителя.`
            : "Не подключён."}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!active ? (
          <Button type="button" onClick={() => setMode("connect")}>
            Подключить Google Диск
          </Button>
        ) : null}
        {active && canManage && drive.needsReconnect ? (
          <Button type="button" onClick={() => setMode("reconnect")}>
            Переподключить
          </Button>
        ) : null}
        {active && canManage ? (
          <Button type="button" variant="secondary" onClick={() => setMode("replace")}>
            Заменить
          </Button>
        ) : null}
        {active ? (
          <Button type="button" variant="secondary" disabled={checking} onClick={check}>
            {checking ? "Проверяем…" : "Проверить доступ"}
          </Button>
        ) : null}
        {active && canManage ? (
          <Button type="button" variant="ghost" onClick={disconnect}>
            Отключить
          </Button>
        ) : null}
      </div>
      {active && !canManage ? (
        <p className="text-[var(--muted-fg)]">
          Заменить или отключить диск может хранитель или владелец проекта.
        </p>
      ) : null}

      <Modal open={mode !== null} onClose={() => setMode(null)} title={mode ? CONNECT_TITLE[mode] : ""}>
        <form method="post" action="/api/cloud/google/authorize" className="space-y-3 text-sm">
          <input type="hidden" name="purpose" value="project" />
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <p data-testid="project-drive-hint">{PROJECT_DRIVE_ACCOUNT_HINT}</p>
          <p className="text-[var(--muted-fg)]">
            Вы станете хранителем диска. Система создаёт папки и файлы в этом аккаунте и выдаёт к ним
            доступ участникам; видит она только то, что создала сама.
          </p>
          {mode === "replace" ? (
            <p className="text-[var(--danger)]">
              Другой аккаунт — с чистого листа: папки и ссылки прежнего диска останутся в его аккаунте,
              новые придётся создавать заново.
            </p>
          ) : null}
          {mode === "reconnect" ? (
            <p className="text-[var(--muted-fg)]">
              Выберите в окне Google тот же аккаунт{drive?.accountEmail ? ` (${drive.accountEmail})` : ""} —
              папки сохранятся. Другой аккаунт — замена с чистого листа.
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setMode(null)}>
              Отмена
            </Button>
            <Button type="submit">Перейти в Google</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
