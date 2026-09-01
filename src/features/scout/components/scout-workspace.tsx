"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
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
import { useActionToast, useToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Modal } from "@/shared/ui/modal";

const initial: ScoutActionState = {};

type LocationOpt = { id: string; name: string; sublocation: string | null };

function locationLabel(loc: { name: string; sublocation: string | null }) {
  return loc.sublocation ? `${loc.name} / ${loc.sublocation}` : loc.name;
}

export function ScoutWorkspace({
  projectId,
  locale,
  candidates,
  locations,
  canWrite,
}: {
  projectId: string;
  locale: string;
  candidates: ScoutCandidateRow[];
  locations: LocationOpt[];
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const bound = createScoutCandidateAction.bind(null, projectId);
  const [state, action, formPending] = useActionState(bound, initial);
  useActionToast(state);

  useEffect(() => {
    if (state.success) setOpen(false);
  }, [state.success]);

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
                <th className="py-2 px-3">Стоимость</th>
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
                  <td className="py-3 px-3">{row.cost?.toString() ?? "—"}</td>
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
                      <form
                        action={async () => {
                          const r = await deleteScoutCandidateAction(projectId, row.id);
                          if (r.error) toast.error(r.error);
                          if (r.success) toast.success(r.success);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button type="submit" variant="danger">
                          ×
                        </Button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Новый кандидат скаута"
        wide
        footer={
          <div className="flex gap-3">
            <Button type="submit" form="scout-form" disabled={formPending}>
              {formPending ? "…" : "Добавить"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
          </div>
        }
      >
        <form id="scout-form" action={action}>
          <ScoutFormFields locations={locations} />
        </form>
      </Modal>
    </div>
  );
}
