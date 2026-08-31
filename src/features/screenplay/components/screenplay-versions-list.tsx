"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteScriptVersionAction,
  duplicateScriptVersionAction,
  setScriptVersionLockedAction,
} from "@/features/screenplay/actions";
import type { ScriptVersionOverviewRow } from "@/features/screenplay/lib/version-types";
import { ScriptVersionTitleEditor } from "@/features/screenplay/components/script-version-title-editor";
import { ScriptVersionNoteEditor } from "@/features/screenplay/components/script-version-note-editor";
import { ScriptVersionActions, type ScriptVersionActionItem } from "@/features/screenplay/components/script-version-actions";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import { useToast } from "@/shared/ui/toast";

const SOURCE_LABELS: Record<string, string> = {
  IMPORTED_DOCX: "Импорт DOCX",
  IMPORTED_OTHER: "Импорт",
  MANUAL: "Вручную",
  DUPLICATED_FROM: "Копия версии",
};

type Props = {
  projectId: string;
  locale: string;
  versions: ScriptVersionOverviewRow[];
  canWrite: boolean;
};

export function ScreenplayVersionsList({
  projectId,
  locale,
  versions,
  canWrite,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const base = `/${locale}/projects/${projectId}/screenplay`;
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  }

  function openCompare() {
    if (selected.length !== 2) return;
    const params = new URLSearchParams({ a: selected[0]!, b: selected[1]! });
    router.push(`${base}/compare?${params.toString()}`);
  }

  function runAction(task: () => Promise<void>) {
    startTransition(() => task());
  }

  function removeVersion(version: ScriptVersionOverviewRow) {
    const label = version.title?.trim() || `версию ${version.versionNumber}`;
    if (
      !window.confirm(
        `Удалить «${label}»? Текст этой версии будет удалён безвозвратно.`,
      )
    ) {
      return;
    }
    runAction(async () => {
      const result = await deleteScriptVersionAction(projectId, version.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Версия удалена");
      setSelected((prev) => prev.filter((id) => id !== version.id));
      router.refresh();
    });
  }

  function duplicateVersion(version: ScriptVersionOverviewRow) {
    runAction(async () => {
      const result = await duplicateScriptVersionAction(projectId, version.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(result.success ?? "Версия продублирована");
      router.refresh();
    });
  }

  function toggleLock(version: ScriptVersionOverviewRow) {
    runAction(async () => {
      const result = await setScriptVersionLockedAction(
        projectId,
        version.id,
        !version.isLocked,
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        version.isLocked ? "Версия разблокирована" : "Версия заблокирована",
      );
      router.refresh();
    });
  }

  function buildActions(version: ScriptVersionOverviewRow): ScriptVersionActionItem[] {
    const items: ScriptVersionActionItem[] = [];

    if (canWrite) {
      items.push({
        id: "duplicate",
        label: "Дублировать версию",
        icon: "duplicate",
        onClick: () => duplicateVersion(version),
        disabled: pending,
      });
    }

    items.push({
      id: "compare",
      label: selected.includes(version.id)
        ? "Убрать из сравнения"
        : "Выбрать для сравнения",
      icon: "compare",
      onClick: () => toggleSelect(version.id),
      disabled: pending,
      active: selected.includes(version.id),
    });

    if (canWrite) {
      items.push({
        id: "lock",
        label: version.isLocked
          ? "Разблокировать версию"
          : "Заблокировать версию",
        icon: version.isLocked ? "unlock" : "lock",
        onClick: () => toggleLock(version),
        disabled: pending,
      });
    }

    if (canWrite && versions.length > 1) {
      items.push({
        id: "delete",
        label: "Удалить версию",
        icon: "delete",
        onClick: () => removeVersion(version),
        disabled: pending || version.isLocked,
        danger: true,
      });
    }

    return items;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">Сценарий</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Версии текста и импорт. Новая версия — при сохранении или импорте.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.length === 2 ? (
            <Button type="button" variant="secondary" onClick={openCompare}>
              Сравнить выбранные
            </Button>
          ) : null}
          {canWrite ? (
            <Link href={`${base}/import`}>
              <Button type="button">Импортировать сценарий</Button>
            </Link>
          ) : null}
        </div>
      </div>

      {versions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted-fg)]">
          <p className="mb-4">Версий сценария пока нет.</p>
          {canWrite ? (
            <Link href={`${base}/import`}>
              <Button type="button">Импортировать первую версию</Button>
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="screenplay-versions-table w-full min-w-[52rem] text-left text-sm">
            <colgroup>
              <col className="screenplay-versions-col-num" />
              <col className="screenplay-versions-col-name" />
              <col className="screenplay-versions-col-timing" />
              <col className="screenplay-versions-col-date" />
              <col className="screenplay-versions-col-author" />
              <col className="screenplay-versions-col-source" />
              <col className="screenplay-versions-col-note" />
              <col className="screenplay-versions-col-actions" />
            </colgroup>
            <thead className="border-b border-[var(--border)] bg-[var(--surface-2)] text-xs text-[var(--muted-fg)]">
              <tr>
                <th>№</th>
                <th>Название</th>
                <th>Хронометраж</th>
                <th>Дата</th>
                <th>Автор</th>
                <th>Источник</th>
                <th className="screenplay-versions-cell--section">Комментарий</th>
                <th className="screenplay-versions-cell--section text-center">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr
                  key={version.id}
                  className={cn(
                    "cursor-pointer border-b border-[var(--border)]/60 hover:bg-[var(--surface-2)]/50",
                    version.isCurrent && "bg-[var(--accent)]/5",
                    selected.includes(version.id) && "bg-[var(--accent)]/8",
                    version.isLocked && "screenplay-versions-row--locked",
                  )}
                  onClick={() => router.push(`${base}/${version.id}`)}
                >
                  <td className="font-medium">{version.versionNumber}</td>
                  <td
                    onClick={(event) => {
                      if (canWrite && !version.isLocked) event.stopPropagation();
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <ScriptVersionTitleEditor
                        projectId={projectId}
                        versionId={version.id}
                        versionNumber={version.versionNumber}
                        title={version.title}
                        canWrite={canWrite && !version.isLocked}
                        variant="table"
                      />
                      {version.isLocked ? (
                        <span
                          className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300"
                          title="Версия заблокирована"
                        >
                          🔒
                        </span>
                      ) : null}
                      {version.isCurrent ? (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                          Текущая
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="tabular-nums text-[var(--foreground)]">
                    <div>{version.timingLabel}</div>
                    {version.timingPages != null ? (
                      <div className="text-[10px] text-[var(--muted-fg)]">
                        ~{version.timingPages} стр.
                      </div>
                    ) : null}
                  </td>
                  <td className="text-[var(--muted-fg)]">
                    {new Intl.DateTimeFormat("ru-RU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(version.createdAt)}
                  </td>
                  <td>{version.createdBy.name}</td>
                  <td className="text-[var(--muted-fg)]">
                    {SOURCE_LABELS[version.sourceType] ?? version.sourceType}
                  </td>
                  <td
                    className="screenplay-versions-cell--section align-top"
                    onClick={(event) => {
                      if (canWrite && !version.isLocked) event.stopPropagation();
                    }}
                  >
                    <ScriptVersionNoteEditor
                      projectId={projectId}
                      versionId={version.id}
                      note={version.note}
                      canWrite={canWrite && !version.isLocked}
                      variant="table"
                    />
                  </td>
                  <td
                    className="screenplay-versions-cell--section align-middle"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ScriptVersionActions
                      actions={buildActions(version)}
                      disabled={pending}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
