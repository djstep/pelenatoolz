"use client";

import { useState } from "react";
import {
  fetchCallSheetXlsx,
  downloadBlob,
  printCallSheet,
} from "@/features/call-sheets/components/call-sheet-print-client";
import { useCallSheetRevision } from "@/features/call-sheets/components/revision-context";
import { SheetBlock } from "@/features/call-sheets/components/sheet-block";
import type { CallSheetStatusValue } from "@/features/call-sheets/lib/revision";
import { CALL_SHEET_STATUS_LABELS } from "@/features/call-sheets/print/stamp";
import {
  approveCallSheetAction,
  reopenCallSheetAction,
  returnCallSheetToDraftAction,
  submitCallSheetForReviewAction,
  type CallSheetStatusResult,
} from "@/features/call-sheets/status-actions";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { toast } from "@/shared/ui/toast";

export type CallSheetStatusPanelData = {
  status: CallSheetStatusValue;
  version: number;
  /** «утверждён 10.09.2026, 17:46 · Иванов» — у утверждённого. */
  approvedLabel: string | null;
  /** Данные дня изменились после утверждения текущей версии (отпечаток ≠ снимка). */
  dataChanged: boolean;
  versions: { version: number; label: string }[];
};

type Command = {
  label: string;
  variant?: "secondary";
  title: string;
  details: string[];
  confirmLabel: string;
  done: string;
  run: (projectId: string, dayId: string, revision: unknown) => Promise<CallSheetStatusResult>;
};

function commandsFor(
  data: CallSheetStatusPanelData,
  canEdit: boolean,
  canApprove: boolean,
): Command[] {
  const next = data.version + 1;
  switch (data.status) {
    case "DRAFT":
      return canEdit
        ? [
            {
              label: "На согласование",
              title: "Отправить вызывной на согласование?",
              details: [
                "Утвердить его сможет участник с правом «Вызывные — утверждение».",
                "Править вызывной до утверждения можно.",
              ],
              confirmLabel: "Отправить",
              done: "Вызывной отправлен на согласование",
              run: submitCallSheetForReviewAction,
            },
          ]
        : [];
    case "IN_REVIEW":
      return [
        ...(canApprove
          ? [
              {
                label: "Утвердить",
                title: `Утвердить вызывной, версия ${data.version}?`,
                details: [
                  "Лист сохранится как есть — печать и Excel утверждённого берутся из этой версии.",
                  "Править утверждённый можно только после «Внести изменения».",
                ],
                confirmLabel: "Утвердить",
                done: `Вызывной утверждён, версия ${data.version}`,
                run: approveCallSheetAction,
              },
            ]
          : []),
        ...(canEdit || canApprove
          ? [
              {
                label: "Вернуть в черновик",
                variant: "secondary" as const,
                title: "Вернуть вызывной в черновик?",
                details: ["Вызывной снова станет черновиком той же версии."],
                confirmLabel: "Вернуть",
                done: "Вызывной возвращён в черновик",
                run: returnCallSheetToDraftAction,
              },
            ]
          : []),
      ];
    case "APPROVED":
      return canEdit
        ? [
            {
              label: "Внести изменения",
              variant: "secondary",
              title: "Внести изменения в утверждённый вызывной?",
              details: [
                `Вызывной станет черновиком версии ${next}.`,
                `Утверждённая версия ${data.version} сохранится — её можно распечатать из списка версий.`,
                "Новую версию нужно будет снова отправить на согласование и утвердить.",
              ],
              confirmLabel: "Внести изменения",
              done: `Черновик версии ${next}`,
              run: reopenCallSheetAction,
            },
          ]
        : [];
  }
}

/**
 * Статус вызывного над блоками правки: статус и версия, кнопки переходов (с подтверждением),
 * плашка «данные дня изменились» у утверждённого, список утверждённых версий с печатью и Excel
 * из снимка. Права проверяет сервер; кнопки — только для подсказки.
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

  const commands = commandsFor(data, canEdit, canApprove);

  return (
    <SheetBlock title="Статус вызывного" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge>{CALL_SHEET_STATUS_LABELS[data.status]}</Badge>
          <span className="font-medium">версия {data.version}</span>
          {data.approvedLabel ? (
            <span className="text-[var(--muted-fg)]">{data.approvedLabel}</span>
          ) : null}
        </div>
        {commands.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {commands.map((command) => (
              <Button
                key={command.label}
                type="button"
                variant={command.variant}
                onClick={() =>
                  void confirm({
                    title: command.title,
                    details: command.details,
                    confirmLabel: command.confirmLabel,
                    action: async () => {
                      const result = track(await command.run(projectId, dayId, revision));
                      if (result.error) return result.error;
                      toast.success(command.done);
                    },
                  })
                }
              >
                {command.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {data.status === "APPROVED" ? (
        <p className="text-xs text-[var(--muted-fg)]">
          Утверждённый вызывной — только просмотр. Лист, печать и Excel — из утверждённой версии.
        </p>
      ) : data.status === "IN_REVIEW" && !canApprove ? (
        <p className="text-xs text-[var(--muted-fg)]">
          Утвердить может участник с правом «Вызывные — утверждение».
        </p>
      ) : null}

      {data.status === "APPROVED" && data.dataChanged ? (
        <p
          role="status"
          className="rounded-lg border border-amber-500/30 bg-[var(--tone-warning-bg)] px-3 py-2 text-sm text-[var(--tone-warning-soft)]"
        >
          Данные дня изменились после утверждения версии {data.version}. На листе — утверждённая
          версия; чтобы учесть изменения, нажмите «Внести изменения» и утвердите новую.
        </p>
      ) : null}

      {data.versions.length > 0 ? (
        <div className="space-y-1">
          <h4 className="sheet-subhead">Утверждённые версии</h4>
          <ul className="space-y-1 text-sm">
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
        </div>
      ) : null}
    </SheetBlock>
  );
}
