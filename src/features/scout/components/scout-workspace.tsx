"use client";

import { useState, useTransition } from "react";
import { useSafeActionState } from "@/shared/ui/forms/use-safe-action-state";
import type { ScoutCandidateStatus } from "@prisma/client";
import Link from "next/link";
import {
  createScoutCandidateAction,
  deleteScoutCandidateAction,
  updateScoutCandidateStatusAction,
  type ScoutActionState,
} from "@/features/scout/actions";
import { ScoutFormFields } from "@/features/scout/components/scout-form-fields";
import type { ScoutCandidateRow } from "@/features/scout/queries";
import { scoutStatusOptions } from "@/features/preproduction/lib/status-labels";
import { StatusSelect } from "@/features/preproduction/components/status-select";
import type { FinanceAccess } from "@/shared/lib/finance-fields";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { useActionToast, useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { Modal } from "@/shared/ui/modal";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import {
  formatLocationTitle,
  type LocationNameSource,
} from "@/features/locations/lib/format-location";

const initial: ScoutActionState = {};

type LocationOpt = { id: string; name: string; parent: { name: string } | null };

function locationLabel(loc: LocationNameSource) {
  return formatLocationTitle(loc, " / ");
}

export function ScoutWorkspace({
  projectId,
  locale,
  candidates,
  locations,
  canWrite,
  finance,
}: {
  projectId: string;
  locale: string;
  candidates: ScoutCandidateRow[];
  locations: LocationOpt[];
  canWrite: boolean;
  /** Стоимость площадки — фин. условие объектов. */
  finance: FinanceAccess;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const confirmDelete = useConfirm();
  const bound = createScoutCandidateAction.bind(null, projectId);
  const [state, action, formPending] = useSafeActionState(bound, initial);
  useActionToast(state);

  useActionSuccess(state, () => setOpen(false));

  function runStatus(candidateId: string, status: ScoutCandidateStatus) {
    startTransition(async () => {
      const result = await updateScoutCandidateStatusAction(
        projectId,
        candidateId,
        status,
      );
      if (result.error) toast.error(result.error);
      if (result.success) toast.success(result.success);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {canWrite ? (
          <Button type="button" onClick={() => setOpen(true)}>
            + Кандидат-локация
          </Button>
        ) : null}
      </div>

      {candidates.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Кандидаты скаута не добавлены.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="glass-table w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="py-2 px-3">Место</th>
                <th className="py-2 px-3">Игровые объекты</th>
                <th className="py-2 px-3">Адрес</th>
                {finance !== "none" ? <th className="py-2 px-3">Стоимость</th> : null}
                <th className="py-2 px-3">Статус</th>
                {canWrite ? <th className="py-2 px-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {candidates.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--border)]/60 hover:bg-[var(--glass-hover)]"
                >
                  <td className="py-3 px-3 font-medium">
                    <Link
                      href={`/${locale}/projects/${projectId}/preproduction/scout/${row.id}`}
                      className="hover:text-[var(--accent)]"
                    >
                      {row.title}
                    </Link>
                  </td>
                  <td className="py-3 px-3 text-[var(--muted-fg)]">
                    {row.locationLinks
                      .map((link) => locationLabel(link.location))
                      .join(" · ") || "—"}
                  </td>
                  <td className="py-3 px-3">{row.address ?? "—"}</td>
                  {finance !== "none" ? (
                    <td className="py-3 px-3">{row.cost?.toString() ?? "—"}</td>
                  ) : null}
                  <td className="py-3 px-3">
                    <StatusSelect
                      value={row.status}
                      options={scoutStatusOptions}
                      disabled={!canWrite || pending || row.status === "APPROVED"}
                      onChange={
                        canWrite && row.status !== "APPROVED"
                          ? (next) => runStatus(row.id, next as ScoutCandidateStatus)
                          : undefined
                      }
                    />
                  </td>
                  {canWrite ? (
                    <td className="py-3 px-3 text-right">
                      <Button
                        type="button"
                        variant="danger"
                        aria-label={`Удалить „${row.title}“`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void confirmDelete({
                            title: `Удалить кандидата „${row.title}“?`,
                            details: ["Связи с локациями удалятся."],
                            action: async () => {
                              const r = await deleteScoutCandidateAction(projectId, row.id);
                              if (r.error) return r.error;
                              if (r.success) toast.success(r.success);
                            },
                          });
                        }}
                      >
                        ×
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        guardUnsaved
        open={open}
        onClose={() => setOpen(false)}
        title="Новый кандидат скаута"
        wide
        footer={
          <div className="flex gap-3">
            <Button type="submit" form="scout-form" disabled={formPending}>
              {formPending ? "…" : "Добавить"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-modal-cancel
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
          </div>
        }
      >
        <form id="scout-form" onSubmit={submitKeepingFields(action)}>
          <ScoutFormFields locations={locations} finance={finance} />
        </form>
      </Modal>
    </div>
  );
}
