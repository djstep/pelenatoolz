"use client";

import { useEffect, useState, useTransition } from "react";
import { useParams } from "next/navigation";
import { BUDGET_DRIVE_STATUS_LABELS } from "@/features/cloud/lib/budget-drive-export-rules";
import type { DriveExportView } from "@/features/cloud/lib/drive-export-service";
import {
  exportBudgetToDriveAction,
  getBudgetDriveStateAction,
  type BudgetDriveState,
} from "@/features/smeta/drive-actions";
import type { BudgetDriveButton } from "@/features/smeta/drive-queries";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

const CURRENT = "current";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** «Уже на диске: ссылка · кто · когда · версия N (статус)». */
function ExistingExport({ view }: { view: DriveExportView }) {
  return (
    <p className="text-[var(--muted-fg)]" data-testid="budget-drive-existing">
      Уже на диске:{" "}
      {view.webUrl ? (
        <a href={view.webUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
          Открыть Google Таблицу
        </a>
      ) : (
        "файл"
      )}
      {" · "}
      {[
        view.uploadedByName,
        formatWhen(view.uploadedAt),
        `${view.version ? `версия ${view.version} ` : ""}(${view.statusLabel})`,
      ]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}

/**
 * «На диск…» сметы цеха: Google Таблица в «Сметы / Цеха / <Цех>» на диске проекта. Версия — по
 * умолчанию последняя утверждённая (у утверждённой) или текущий лист; `version` — страница
 * утверждённой версии, выгружается только она. Права и всё остальное проверяет сервер.
 * `button` — от страницы: null — права нет (ничего не показываем), `notice` — диск недоступен.
 */
export function BudgetDriveExport({
  projectId,
  departmentId,
  button,
  version: fixedVersion,
  beforeExport,
  className,
}: {
  projectId: string;
  departmentId: string;
  button: BudgetDriveButton | null;
  version?: number;
  /** Досохранить правки главы перед выгрузкой (false — не выгружать). */
  beforeExport?: () => Promise<boolean>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!button) return null;
  if (button.notice) {
    return (
      <span className="max-w-xs text-xs text-[var(--muted-fg)]" data-testid="budget-drive-unavailable">
        На диск: {button.notice}
      </span>
    );
  }
  return (
    <>
      <Button type="button" variant="secondary" className={className} onClick={() => setOpen(true)}>
        На диск…
      </Button>
      {open ? (
        <BudgetDriveModal
          projectId={projectId}
          departmentId={departmentId}
          fixedVersion={fixedVersion}
          beforeExport={beforeExport}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function BudgetDriveModal({
  projectId,
  departmentId,
  fixedVersion,
  beforeExport,
  onClose,
}: {
  projectId: string;
  departmentId: string;
  fixedVersion?: number;
  beforeExport?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const toast = useToast();
  const params = useParams<{ locale?: string }>();
  const [state, setState] = useState<BudgetDriveState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState<string>(fixedVersion ? String(fixedVersion) : CURRENT);
  const [done, setDone] = useState<{ message: string; view: DriveExportView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void getBudgetDriveStateAction(projectId, departmentId).then((res) => {
      if (cancelled) return;
      if ("error" in res) {
        setLoadError(res.error);
        return;
      }
      setState(res);
      if (!fixedVersion) setVersion(res.defaultVersion ? String(res.defaultVersion) : CURRENT);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, departmentId, fixedVersion]);

  const ready = state != null && !state.unavailable;
  const settingsHref = `/${params.locale ?? "ru"}/projects/${projectId}/settings`;

  function upload() {
    if (!ready) return;
    setError(null);
    setDone(null);
    setCopied(false);
    startTransition(async () => {
      if (beforeExport && !(await beforeExport())) {
        setError("Сначала должны сохраниться правки — смета не выгружена");
        return;
      }
      const res = await exportBudgetToDriveAction(projectId, {
        target: "department",
        departmentId,
        version: version === CURRENT ? null : Number(version),
      });
      if ("error" in res) {
        setError(res.error);
        if (res.projectDrive) {
          // Диск проекта стал недоступен — обновить окно (вместо кнопки — почему).
          const fresh = await getBudgetDriveStateAction(projectId, departmentId);
          if (!("error" in fresh)) setState(fresh);
        }
        return;
      }
      setDone({ message: res.message, view: res.export });
      toast.success(res.message);
      setState((prev) => (prev ? { ...prev, existing: res.export, outdated: res.outdated, keeperHint: null } : prev));
    });
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      toast.error("Не удалось скопировать — выделите ссылку вручную");
    }
  }

  const approved = state?.status === "APPROVED";
  const versions = fixedVersion ? (state?.versions.filter((v) => v.version === fixedVersion) ?? []) : (state?.versions ?? []);

  return (
    <Modal
      open
      onClose={onClose}
      title="Смета на диск"
      footer={
        <div className="flex gap-2">
          {ready ? (
            <Button type="button" disabled={pending} onClick={upload}>
              {pending ? "Выгрузка…" : state?.existing ? "Выгрузить и заменить" : "Выгрузить"}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm" data-testid="budget-drive-modal">
        {loadError ? <p className="text-[var(--danger)]">{loadError}</p> : null}
        {!state && !loadError ? <p className="text-[var(--muted-fg)]">Загрузка…</p> : null}

        {state ? (
          <>
            {state.unavailable ? (
              <p
                className="rounded-lg border border-amber-500/30 bg-[var(--tone-warning-bg)] px-3 py-2 text-[var(--tone-warning-soft)]"
                data-testid="budget-drive-project-unavailable"
              >
                {state.unavailable}{" "}
                {/настройках проекта/.test(state.unavailable) ? (
                  <a href={settingsHref} className="font-medium underline underline-offset-2">
                    Открыть настройки проекта
                  </a>
                ) : null}
              </p>
            ) : (
              <>
                <p>
                  Google Таблица — в папке «PELENA · &lt;Проект&gt; / Сметы / Цеха / {state.departmentName}» на диске
                  проекта. Повторная выгрузка заменяет тот же файл; скачать, распечатать и скопировать его
                  комментаторы не могут.
                </p>
                <p className="text-[var(--muted-fg)]" data-testid="budget-drive-audience">
                  Кто увидит: {state.audience}
                </p>

                <div>
                  <Label htmlFor="budget-drive-version">Версия</Label>
                  <Select
                    id="budget-drive-version"
                    value={version}
                    disabled={fixedVersion != null}
                    onChange={(e) => setVersion(e.target.value)}
                  >
                    {!approved && !fixedVersion ? (
                      <option value={CURRENT}>{`Текущий лист — ${BUDGET_DRIVE_STATUS_LABELS[state.status]}`}</option>
                    ) : null}
                    {versions.map((v) => (
                      <option key={v.version} value={String(v.version)}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </div>

                {state.existing && !done ? <ExistingExport view={state.existing} /> : null}
                {state.outdated ? (
                  <p className="text-[var(--tone-warning-soft)]" data-testid="budget-drive-outdated">
                    {state.outdated}
                  </p>
                ) : null}
                {state.keeperHint ? (
                  <p
                    className="rounded-lg border border-amber-500/30 bg-[var(--tone-warning-bg)] px-3 py-2 text-[var(--tone-warning-soft)]"
                    data-testid="budget-drive-keeper-hint"
                  >
                    {state.keeperHint}
                  </p>
                ) : null}
                <p className="text-[var(--muted-fg)]" data-testid="budget-drive-approval-note">
                  {state.approvalNote}
                </p>
              </>
            )}

            {error ? (
              <p role="alert" className="text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            {done ? (
              <div
                role="status"
                className="space-y-2 rounded-xl border border-[var(--border)] px-3 py-2"
                data-testid="budget-drive-done"
              >
                <p>{done.message}</p>
                {done.view.webUrl ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={done.view.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-[var(--accent)] hover:underline"
                    >
                      {done.view.webUrl}
                    </a>
                    <Button type="button" variant="secondary" onClick={() => void copyLink(done.view.webUrl!)}>
                      {copied ? "Скопировано" : "Копировать ссылку"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
