"use client";

import { useEffect, useState, useTransition } from "react";
import { useParams } from "next/navigation";
import type { DriveExportView } from "@/features/cloud/lib/drive-export-service";
import { ExistingExport } from "@/features/smeta/components/budget-drive-export";
import {
  exportBudgetSummaryToDriveAction,
  getBudgetSummaryDriveStateAction,
  type BudgetSummaryDriveState,
} from "@/features/smeta/drive-actions";
import type { BudgetDriveButton } from "@/features/smeta/drive-queries";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

const APPROVED = "approved";
const DRAFTS = "drafts";

/**
 * «На диск…» сводной: Google Таблица в «Сметы / Сводная» на диске проекта, видят только продюсеры.
 * Режим — «утверждённые версии» / «с черновиками» (по умолчанию — как открыта страница).
 * `button` — от страницы: null — не продюсер (ничего не показываем), `notice` — диск недоступен.
 */
export function BudgetSummaryDriveExport({
  projectId,
  drafts,
  button,
}: {
  projectId: string;
  drafts: boolean;
  button: BudgetDriveButton | null;
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
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        На диск…
      </Button>
      {open ? <SummaryDriveModal projectId={projectId} drafts={drafts} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SummaryDriveModal({
  projectId,
  drafts: initialDrafts,
  onClose,
}: {
  projectId: string;
  drafts: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const params = useParams<{ locale?: string }>();
  const [state, setState] = useState<BudgetSummaryDriveState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState(initialDrafts ? DRAFTS : APPROVED);
  const [done, setDone] = useState<{ message: string; view: DriveExportView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void getBudgetSummaryDriveStateAction(projectId).then((res) => {
      if (cancelled) return;
      if ("error" in res) setLoadError(res.error);
      else setState(res);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const ready = state != null && !state.unavailable;
  const settingsHref = `/${params.locale ?? "ru"}/projects/${projectId}/settings`;

  function upload() {
    if (!ready) return;
    setError(null);
    setDone(null);
    setCopied(false);
    startTransition(async () => {
      const res = await exportBudgetSummaryToDriveAction(projectId, { target: "summary", drafts: mode === DRAFTS });
      if ("error" in res) {
        setError(res.error);
        if (res.projectDrive) {
          // Диск проекта стал недоступен — обновить окно (вместо кнопки — почему).
          const fresh = await getBudgetSummaryDriveStateAction(projectId);
          if (!("error" in fresh)) setState(fresh);
        }
        return;
      }
      setDone({ message: res.message, view: res.export });
      toast.success(res.message);
      setState((prev) => (prev ? { ...prev, existing: res.export, keeperHint: null } : prev));
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

  return (
    <Modal
      open
      onClose={onClose}
      title="Сводная смета на диск"
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
                  Google Таблица — в папке «PELENA · &lt;Проект&gt; / Сметы / Сводная» на диске проекта: «Свод» и
                  лист на каждый цех. Файл один — повторная выгрузка заменяет его (и имя); скачать, распечатать и
                  скопировать его комментаторы не могут.
                </p>
                <p className="text-[var(--muted-fg)]" data-testid="budget-drive-audience">
                  Кто увидит: {state.audience}
                </p>

                <div>
                  <Label htmlFor="budget-summary-drive-mode">Листы цехов</Label>
                  <Select id="budget-summary-drive-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                    <option value={APPROVED}>Утверждённые версии</option>
                    <option value={DRAFTS}>С черновиками</option>
                  </Select>
                </div>

                <p className="text-[var(--muted-fg)]" data-testid="budget-drive-snapshot">
                  {state.snapshot}
                </p>
                {state.existing && !done ? <ExistingExport view={state.existing} /> : null}
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
