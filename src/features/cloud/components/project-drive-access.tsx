"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  retryProjectDriveGrantAction,
  syncProjectDriveAccessAction,
} from "@/features/cloud/project-drive-actions";
import type { CloudActionState } from "@/features/cloud/actions";
import type { DriveAccessOverview } from "@/features/cloud/lib/drive-access-sync";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

/**
 * «Диск проекта» → доступы к папкам (только продюсерам и владельцу; почты видят только они).
 * Кто какую папку получает — решает сервер; здесь только итог, «Синхронизировать» и «Повторить».
 */
export function ProjectDriveAccess({
  projectId,
  overview,
}: {
  projectId: string;
  overview: DriveAccessOverview;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  // Папки смет — первыми: там деньги.
  const unsynced = [...overview.unsynced].sort((a, b) => Number(b.budget) - Number(a.budget));
  const unsyncedBudget = unsynced.filter((row) => row.budget).length;

  function run(action: () => Promise<CloudActionState>) {
    start(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 border-t border-[var(--border)]/60 pt-4 text-sm" data-testid="project-drive-access">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Доступы к папкам</p>
          <p className="text-[var(--muted-fg)]" data-testid="project-drive-access-summary">
            {overview.folders === 0
              ? "Папок ещё нет — они создаются при первой выгрузке, тогда же выдаются доступы."
              : `Папок: ${overview.folders} · выдано доступов: ${overview.granted}. «Общая» — всем с просмотром вызывных, папка цеха — главам цеха и продюсерам; сметы: «Сводная» — продюсерам, папка цеха — главам цеха и продюсерам; роль — комментатор.`}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => syncProjectDriveAccessAction(projectId))}
        >
          {pending ? "Синхронизируем…" : "Синхронизировать доступы"}
        </Button>
      </div>

      {overview.foreign.length > 0 ? (
        <div
          className="space-y-2 rounded-lg border border-[var(--danger)]/50 px-3 py-2"
          data-testid="project-drive-foreign"
        >
          <p className="font-medium text-[var(--danger)]">
            Доступы к папкам смет, выданные не системой. Система их не снимает: человек сохранит доступ и после
            ухода из проекта. Проверьте в Google Диске, кому они нужны.
          </p>
          <ul className="space-y-1">
            {overview.foreign.map((w) => (
              <li key={w.folderId} data-testid="project-drive-foreign-row">
                <div>
                  К папке «{w.folder}» есть доступы, выданные не системой: {w.count}
                </div>
                <div className="break-all text-xs text-[var(--muted-fg)]">{w.who.join(", ")}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {unsynced.length > 0 ? (
        <div data-testid="project-drive-unsynced">
          <p className="mb-2 font-medium text-[var(--danger)]">
            Не синхронизировано: {unsynced.length}
            {unsyncedBudget > 0 ? ` (из них по папкам смет — ${unsyncedBudget})` : ""}
          </p>
          <ul className="divide-y divide-[var(--border)]/60 rounded-lg border border-[var(--border)]/60">
            {unsynced.map((row) => (
              <li
                key={row.id}
                className={
                  row.budget
                    ? "flex flex-wrap items-center gap-x-4 gap-y-1 border-l-4 border-l-[var(--danger)] px-3 py-2"
                    : "flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
                }
                data-testid="project-drive-unsynced-row"
                data-budget={row.budget ? "1" : undefined}
              >
                <div className="min-w-0 flex-1">
                  <div>
                    {row.budget ? (
                      <span
                        className="mr-2 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs font-medium text-[var(--danger)]"
                        title="Папка смет: пока доступ не снят, человек видит деньги"
                      >
                        смета
                      </span>
                    ) : null}
                    <span className="font-medium">{row.name}</span>
                    <span className="text-[var(--muted-fg)]">
                      {" · "}
                      {row.folder}
                      {" · "}
                      {row.action === "remove" ? "снять доступ" : "выдать доступ"}
                    </span>
                  </div>
                  <div className="break-all text-xs text-[var(--muted-fg)]">
                    {row.email}
                    {row.notGoogleEmail ? (
                      <span
                        className="ml-2 rounded bg-[var(--surface-2)] px-1.5 py-0.5"
                        title="Открыть папку можно только с Google-аккаунтом на эту почту"
                      >
                        почта не Google
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-[var(--danger)]">{row.reason}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => retryProjectDriveGrantAction(projectId, row.id))}
                >
                  Повторить
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
