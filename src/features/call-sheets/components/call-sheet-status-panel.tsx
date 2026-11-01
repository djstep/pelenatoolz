"use client";

import { useState } from "react";
import {
  fetchCallSheetXlsx,
  downloadBlob,
  printCallSheet,
} from "@/features/call-sheets/components/call-sheet-print-client";
import { CallSheetStatusBadge } from "@/features/call-sheets/components/call-sheet-status-badge";
import { useCallSheetRevision } from "@/features/call-sheets/components/revision-context";
import type { CallSheetStatusValue } from "@/features/call-sheets/lib/revision";
import { statusButtonsFor } from "@/features/call-sheets/lib/status-commands";
import type { StatusCommand } from "@/features/call-sheets/lib/status-rules";
import {
  approveCallSheetAction,
  reopenCallSheetAction,
  returnCallSheetToDraftAction,
  submitCallSheetForReviewAction,
  type CallSheetStatusResult,
} from "@/features/call-sheets/status-actions";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { toast } from "@/shared/ui/toast";

export type CallSheetStatusPanelData = {
  status: CallSheetStatusValue;
  version: number;
  /** Данные дня изменились после утверждения текущей версии (отпечаток ≠ снимка). */
  dataChanged: boolean;
  versions: { version: number; label: string }[];
};

const ACTIONS: Record<
  StatusCommand,
  (projectId: string, dayId: string, revision: unknown) => Promise<CallSheetStatusResult>
> = {
  submit: submitCallSheetForReviewAction,
  approve: approveCallSheetAction,
  return: returnCallSheetToDraftAction,
  reopen: reopenCallSheetAction,
};

/**
 * Панель статуса вверху страницы вызывного: цветная плашка статуса, версия, кнопки переходов
 * (с коротким подтверждением), плашка «данные дня изменились» у утверждённого, утверждённые
 * версии с печатью и Excel из снимка. Права проверяет сервер; кнопки — только для подсказки.
 */
export function CallSheetStatusPanel({
  projectId,
  dayId,
  data,
  canEdit,
  canApprove,
}: {
  projectId: string;
  dayId: string;
  data: CallSheetStatusPanelData;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const confirm = useConfirm();
  const { revision, track } = useCallSheetRevision();
  const [busy, setBusy] = useState<string | null>(null);

  async function exportVersion(version: number, kind: "print" | "xlsx") {
    setBusy(`${kind}-${version}`);
    try {
      if (kind === "print") {
        const result = await printCallSheet(projectId, dayId, version);
        if (result.error) toast.error(result.error);
        return;
      }
      const result = await fetchCallSheetXlsx(projectId, dayId, version);
      if ("error" in result) toast.error(result.error);
      else downloadBlob(result.blob, result.fileName);
    } finally {
      setBusy(null);
    }
  }

  const buttons = statusButtonsFor(data, { canEdit, canApprove });

  return (
    <section
      aria-label="Статус вызывного"
      className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <CallSheetStatusBadge status={data.status} />
          <span className="font-medium">версия {data.version}</span>
        </div>
        {buttons.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {buttons.map((b) => (
              <Button
                key={b.command}
                type="button"
                variant={b.secondary ? "secondary" : undefined}
                onClick={() =>
                  void confirm({
                    title: b.confirmTitle,
                    confirmLabel: b.confirmLabel,
                    action: async () => {
                      const result = track(await ACTIONS[b.command](projectId, dayId, revision));
                      if (result.error) return result.error;
                      toast.success(b.done);
                    },
                  })
                }
              >
                {b.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {data.status === "APPROVED" && data.dataChanged ? (
        <p
          role="status"
          className="rounded-lg border border-amber-500/30 bg-[var(--tone-warning-bg)] px-3 py-2 text-sm text-[var(--tone-warning-soft)]"
        >
          Данные дня изменились после утверждения версии {data.version}
        </p>
      ) : null}

      {data.versions.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--muted-fg)]">
            Утверждённые версии ({data.versions.length})
          </summary>
          <ul className="mt-1 space-y-1">
            {data.versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center justify-between gap-2">
                <span>{v.label}</span>
                <span className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void exportVersion(v.version, "print")}
                  >
                    {busy === `print-${v.version}` ? "…" : "Печать"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void exportVersion(v.version, "xlsx")}
                  >
                    {busy === `xlsx-${v.version}` ? "…" : "Excel"}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
